package com.myexpense.backend.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.myexpense.backend.ratelimit.AuthRateLimitFilter;
import com.myexpense.backend.ratelimit.AuthRateLimitProperties;
import com.myexpense.backend.ratelimit.RateLimiter;
import com.myexpense.backend.security.JwtAuthenticationFilter;
import com.myexpense.backend.security.JwtTokenProvider;
import com.myexpense.backend.security.RestAccessDeniedHandler;
import com.myexpense.backend.security.RestAuthenticationEntryPoint;
import com.myexpense.backend.web.ApiErrorResponseWriter;

/**
 * Single {@code SecurityFilterChain}, stateless, matching the shape
 * documented in security-architecture.md §10.
 *
 * <p>{@code JwtAuthenticationFilter} and {@code AuthRateLimitFilter} are
 * constructed directly here (not {@code @Component}-scanned) and added only
 * to this chain — see their own Javadoc for why. Everything else they
 * depend on ({@code JwtTokenProvider}, {@code RateLimiter}, the rate-limit
 * properties, the error-response writer) are ordinary constructor-injected
 * beans.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final RateLimiter rateLimiter;
    private final AuthRateLimitProperties authRateLimitProperties;
    private final ApiErrorResponseWriter apiErrorResponseWriter;
    private final RestAuthenticationEntryPoint restAuthenticationEntryPoint;
    private final RestAccessDeniedHandler restAccessDeniedHandler;
    private final String allowedOriginsProperty;

    public SecurityConfig(
            JwtTokenProvider jwtTokenProvider,
            RateLimiter rateLimiter,
            AuthRateLimitProperties authRateLimitProperties,
            ApiErrorResponseWriter apiErrorResponseWriter,
            RestAuthenticationEntryPoint restAuthenticationEntryPoint,
            RestAccessDeniedHandler restAccessDeniedHandler,
            @Value("${app.security.cors.allowed-origins:}") String allowedOriginsProperty) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.rateLimiter = rateLimiter;
        this.authRateLimitProperties = authRateLimitProperties;
        this.apiErrorResponseWriter = apiErrorResponseWriter;
        this.restAuthenticationEntryPoint = restAuthenticationEntryPoint;
        this.restAccessDeniedHandler = restAccessDeniedHandler;
        this.allowedOriginsProperty = allowedOriginsProperty;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        JwtAuthenticationFilter jwtAuthenticationFilter = new JwtAuthenticationFilter(jwtTokenProvider);
        AuthRateLimitFilter authRateLimitFilter =
                new AuthRateLimitFilter(rateLimiter, authRateLimitProperties, apiErrorResponseWriter);

        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Logout is the one auth endpoint that requires a
                        // valid access token (authentication-api.md §4) —
                        // matched before the broader permitAll below.
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/logout").authenticated()
                        .requestMatchers("/api/v1/auth/**").permitAll()
                        // No actuator endpoints are exposed this phase
                        // (spring-boot-starter-actuator isn't a dependency
                        // yet) — add a permitAll matcher here if/when one is
                        // introduced, per security-architecture.md §10.
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(restAuthenticationEntryPoint)
                        .accessDeniedHandler(restAccessDeniedHandler))
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(authRateLimitFilter, JwtAuthenticationFilter.class);

        return http.build();
    }

    private CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        List<String> allowedOrigins = Arrays.stream(allowedOriginsProperty.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
        // Deliberately empty (not "*") when unconfigured — CORS is closed by
        // default until real origins are set (security-architecture.md §6).
        // The mobile app itself is unaffected either way: native HTTP
        // clients are not subject to CORS.
        configuration.setAllowedOrigins(allowedOrigins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
