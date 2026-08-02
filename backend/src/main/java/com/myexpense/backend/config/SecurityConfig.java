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

import com.myexpense.backend.ratelimit.ApiRateLimitFilter;
import com.myexpense.backend.ratelimit.ApiRateLimitProperties;
import com.myexpense.backend.ratelimit.AuthRateLimitFilter;
import com.myexpense.backend.ratelimit.AuthRateLimitProperties;
import com.myexpense.backend.ratelimit.RateLimiter;
import com.myexpense.backend.security.JwtAuthenticationFilter;
import com.myexpense.backend.security.JwtTokenProvider;
import com.myexpense.backend.security.RestAccessDeniedHandler;
import com.myexpense.backend.security.RestAuthenticationEntryPoint;
import com.myexpense.backend.sync.WriteContextFilter;
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
    private final ApiRateLimitProperties apiRateLimitProperties;
    private final ApiErrorResponseWriter apiErrorResponseWriter;
    private final RestAuthenticationEntryPoint restAuthenticationEntryPoint;
    private final RestAccessDeniedHandler restAccessDeniedHandler;
    private final String allowedOriginsProperty;

    public SecurityConfig(
            JwtTokenProvider jwtTokenProvider,
            RateLimiter rateLimiter,
            AuthRateLimitProperties authRateLimitProperties,
            ApiRateLimitProperties apiRateLimitProperties,
            ApiErrorResponseWriter apiErrorResponseWriter,
            RestAuthenticationEntryPoint restAuthenticationEntryPoint,
            RestAccessDeniedHandler restAccessDeniedHandler,
            @Value("${app.security.cors.allowed-origins:}") String allowedOriginsProperty) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.rateLimiter = rateLimiter;
        this.authRateLimitProperties = authRateLimitProperties;
        this.apiRateLimitProperties = apiRateLimitProperties;
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
        ApiRateLimitFilter apiRateLimitFilter =
                new ApiRateLimitFilter(rateLimiter, apiRateLimitProperties, apiErrorResponseWriter);

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
                        // Domain 2 (User & Settings) — every /users/** route
                        // requires a valid access token (api-overview.md §2).
                        // Technically already covered by anyRequest() below;
                        // stated explicitly because this is the first
                        // authenticated domain and the rule must survive any
                        // future loosening of the catch-all.
                        .requestMatchers("/api/v1/users/**").authenticated()
                        // Domain 3 (Categories) — api-overview.md §3: all
                        // five endpoints require a valid access token (three
                        // until 2026-10-25, when ADR 0021 added
                        // DELETE /categories/{id} and GET /categories/{id}/usage
                        // under this same prefix). Stated explicitly for the
                        // same reason as /users/** above, not because
                        // anyRequest() below would miss it.
                        //
                        // The two new routes needed nothing here and nothing in
                        // the rate limiter: this matcher is method-agnostic, so
                        // the DELETE is covered, and ApiRateLimitFilter's
                        // default per-user tier already keys off every
                        // /api/v1/** path except /api/v1/auth/**. Neither
                        // warrants a stricter tier (ADR 0021 follow-up item 9,
                        // security-architecture.md §11) — do not add a second
                        // mechanism.
                        .requestMatchers("/api/v1/categories/**").authenticated()
                        // Domain 4 (Transactions) — api-overview.md §4: all
                        // five endpoints require a valid access token. Stated
                        // explicitly for the same reason as the two above, not
                        // because anyRequest() below would miss it.
                        //
                        // Rate limiting needs nothing here: ApiRateLimitFilter
                        // (added with Domain 2) keys the default per-user tier
                        // off every /api/v1/** path except /api/v1/auth/**, so
                        // these five are covered the moment they exist — do not
                        // add a second mechanism (security-architecture.md §11,
                        // backend/README.md §6). The one endpoint in §4 that
                        // WOULD need a stricter tier,
                        // POST /receipts/upload-signature, is not implemented
                        // this phase; it needs its own two limits when it lands
                        // (§11's table), and it is not under this path prefix.
                        .requestMatchers("/api/v1/transactions/**").authenticated()
                        // Statistics (api-overview.md §14) — the one endpoint,
                        // GET /statistics/categories, requires a valid access
                        // token. Stated explicitly for the same reason as the
                        // three above, not because anyRequest() below would
                        // miss it.
                        //
                        // It is owner-scoped and FREE: 403 PREMIUM_REQUIRED is
                        // not a valid response from this path (ADR 0022 §7), so
                        // there is deliberately no .hasAuthority/@PreAuthorize
                        // here and no premium read in its service. Rate
                        // limiting again needs nothing: ApiRateLimitFilter's
                        // default per-user tier covers every /api/v1/** path
                        // except /api/v1/auth/**, which §14.1's error table
                        // confirms is the right tier for an owner-scoped read —
                        // do not add a second mechanism.
                        .requestMatchers("/api/v1/statistics/**").authenticated()
                        // Domain 6 sub-step 1 (Contacts) — api-overview.md §6:
                        // all three endpoints require a valid access token.
                        // Stated explicitly for the same reason as the four
                        // above, not because anyRequest() below would miss it.
                        //
                        // Owner-scoped (contacts.owner_user_id) — the only table
                        // in this domain that still is (data-model.md §4's
                        // note). The scoping itself is NOT here: it is the
                        // authenticated principal passed into ContactService,
                        // which filters every read and write by it. A matcher
                        // can only say "a token is required".
                        //
                        // RATE LIMITING IS THE ONE PLACE THIS DOMAIN NEEDS MORE
                        // THAN THE DEFAULT TIER. ApiRateLimitFilter's per-user
                        // tier covers every /api/v1/** path except
                        // /api/v1/auth/**, so these three inherit it — and
                        // POST /contacts/{id}/invite carries TWO FURTHER limits
                        // (a burst and a 24-hour cap) applied inside
                        // ContactInviteService, plus the two contact_invites
                        // window checks that bound real sends.
                        // security-architecture.md §11 names it "the single
                        // strictest case in the entire API" because it texts a
                        // third party who consented to nothing, at real cost.
                        // Those limits are deliberately NOT a second filter
                        // here: they need the resolved contact and the ledger,
                        // which only the service has, and AuthService already
                        // sets the precedent of layering a per-principal limit
                        // over a filter.
                        .requestMatchers("/api/v1/contacts/**").authenticated()
                        // Domain 6 sub-step 2 (Groups) — api-overview.md §7: all
                        // four endpoints require a valid access token.
                        //
                        // *** AUTHENTICATED IS NECESSARY AND NOWHERE NEAR
                        // SUFFICIENT HERE, AND THIS IS THE FIRST PREFIX IN THIS
                        // CHAIN WHERE THAT IS TRUE. *** Every §7 route reads or
                        // writes a resource that is legitimately SHARED by more
                        // than one user, so no URL rule and no owner-id filter
                        // can authorize it (ADR 0014 §1/§2, V10's RULE 1). The
                        // real check is "does a group_members row exist for
                        // (groupId, principal)", re-derived per request in
                        // GroupService and answered with 404 — never 403, which
                        // would confirm a group's existence to a non-member
                        // (security-architecture.md §2).
                        //
                        // Deliberately NO .hasAuthority and NO @PreAuthorize on
                        // these routes: the decision needs a database lookup
                        // keyed on a path variable, so expressing it as a
                        // method-security expression would either duplicate the
                        // service's check or move it somewhere a reviewer does
                        // not look. One place, in the service.
                        //
                        // Rate limiting needs nothing beyond the default tier.
                        // The two write paths can trigger an invite SMS, but
                        // those sends are bounded by the contact_invites window
                        // limits rather than by a bucket on these routes: a
                        // bucket rejection would fail the group write itself,
                        // which ADR 0015 §4 forbids.
                        .requestMatchers("/api/v1/groups/**").authenticated()
                        // Domain 6 sub-step 3 (Split expenses) — api-overview.md
                        // §9: all three endpoints require a valid access token.
                        //
                        // Membership-gated for the same reason /groups/** is, with
                        // one addition that is new here: a split expense's target
                        // may be a GROUP or a PAIR, so the check is either "does a
                        // group_members row exist for (groupId, principal)" or
                        // "is the principal a party to this individual_balances
                        // row" (ADR 0023 §1.4 — the first call site the API's §2
                        // convention has ever had for the second half of its own
                        // definition). Both live in SplitExpenseService and both
                        // answer 404, never 403.
                        //
                        // Rate limiting needs nothing beyond the default per-user
                        // tier: unlike §7's write paths, §9.1 triggers no SMS and
                        // no external call at all, so there is nothing for a
                        // second bucket to protect.
                        .requestMatchers("/api/v1/split-expenses/**").authenticated()
                        // Domain 6 sub-steps 3 and 4 — api-overview.md §8.1
                        // (GET /splits/individuals) and §10.1
                        // (POST /splits/settle). Both require a valid access
                        // token.
                        //
                        // *** THE SETTLE ROUTE IS THE MOST CONSEQUENTIAL WRITE IN
                        // THIS API AND IT IS STILL JUST .authenticated() HERE. ***
                        // Its real gate is three service-layer checks no URL rule
                        // could express: the caller's membership, THE
                        // COUNTERPART'S membership (ADR 0023 §4, Backend follow-up
                        // item 6 — 404 and never 403 for a non-member), and the
                        // settlement direction derived from the ledger itself.
                        // Deliberately NO .hasAuthority and NO @PreAuthorize, for
                        // the reason the /groups/** block above gives: the
                        // decision needs database lookups keyed on body fields.
                        //
                        // GET /splits/individuals is membership-gated too, not
                        // owner-scoped — it reads BOTH sides of every pair the
                        // caller is part of. Narrowing it to the caller's own
                        // user_id is the bug ADR 0023 §1.4 fixed, and no security
                        // configuration could catch that one, because the endpoint
                        // still returns plausible data.
                        //
                        // Default rate-limit tier again, and no stricter one:
                        // §10.1 has no external side effect either (there is no
                        // payment provider behind 'upi' — the method is a label,
                        // ADR 0014 §5 having deferred billing entirely).
                        .requestMatchers("/api/v1/splits/**").authenticated()
                        // Domain 7 (Activity log) — api-overview.md §11: the one
                        // endpoint, GET /activities, requires a valid access
                        // token. Stated explicitly for the same reason as the
                        // blocks above, not because anyRequest() below would
                        // miss it.
                        //
                        // OWNER-SCOPED, and here that is the whole access
                        // control rather than a shortcut: activities are fanned
                        // out ONE PRIVATELY-OWNED ROW PER AFFECTED MEMBER, so a
                        // shared event is N rows and no row has two readers.
                        // That is the opposite of /groups/** and /splits/**
                        // above, where ownership is the WRONG test. No
                        // membership check exists on this read and none should
                        // be added (V13's own note on the table).
                        //
                        // The scoping itself is NOT here — it is the user_id
                        // predicate in ActivityRepository#findFiltered, bound
                        // from @CurrentUserId. No URL rule could express it.
                        //
                        // Method-agnostic on purpose, like every matcher above,
                        // even though §11 defines only a GET: an activities row
                        // is immutable and there is no write endpoint to
                        // authorize. Default rate-limit tier, nothing stricter —
                        // an owner-scoped read with no external side effect.
                        .requestMatchers("/api/v1/activities/**").authenticated()
                        // Domain 7 (Notifications) — api-overview.md §12: all
                        // three endpoints require a valid access token.
                        //
                        // Owner-scoped for the same structural reason as
                        // /activities/** above. The two mark-read writes are
                        // still just .authenticated() here: §12.2's real gate is
                        // the owner-scoped lookup that produces
                        // 404 NOTIFICATION_NOT_FOUND (NEVER 403) and §12.3's is
                        // the user_id predicate inside its bulk UPDATE —
                        // neither is a URL rule, and `read` is the only column
                        // either one can touch.
                        //
                        // This matcher covers BOTH patch paths (/{id}/read and
                        // /read-all) because it is method- and
                        // suffix-agnostic. Default rate-limit tier and nothing
                        // stricter: neither write has an external side effect —
                        // notifications are poll-based this phase, with no push
                        // provider behind them (ADR 0014, Out of scope) — so
                        // there is nothing for a second bucket to protect.
                        .requestMatchers("/api/v1/notifications/**").authenticated()
                        // Domain 5 (Budget) — api-overview.md §5: all three
                        // endpoints require a valid access token. Stated
                        // explicitly for the same reason as every block above,
                        // not because anyRequest() below would miss it.
                        //
                        // OWNER-SCOPED, and here that is the whole access
                        // control: a budget period belongs to exactly one user
                        // and is never shared, unlike §7's groups and §9's
                        // splits. The scoping itself is NOT here — it is the
                        // user_id predicate bound from @CurrentUserId in
                        // BudgetPeriodRepository, which no URL rule could
                        // express. An unknown-or-not-mine period id answers
                        // 404 BUDGET_PERIOD_NOT_FOUND, NEVER 403.
                        //
                        // *** §5.1 ANSWERS 404 NO_ACTIVE_PERIOD ON THE HAPPY
                        // PATH, and that is not an authorization failure. *** It
                        // is ADR 0011's first-run signal for a user who has
                        // never saved a period, which is every existing user
                        // until they save one. Nothing in this chain should ever
                        // be changed to treat it as a 401/403 condition.
                        //
                        // This matcher covers all three paths because it is
                        // method- and suffix-agnostic (/active-period,
                        // /periods and /periods/{id}). Default rate-limit tier
                        // and nothing stricter: ApiRateLimitFilter already keys
                        // the per-user tier off every /api/v1/** path except
                        // /api/v1/auth/**, and no §5 endpoint has an external
                        // side effect — there is no send, no upload and no
                        // provider behind any of them (security-architecture.md
                        // §11). Do not add a second mechanism.
                        .requestMatchers("/api/v1/budget/**").authenticated()
                        // ADR 0027 §6.5 (BE-8) — the two change-log reads.
                        // Owner-scoped in ChangeLogService (user_id = caller);
                        // default rate-limit tier, nothing stricter.
                        .requestMatchers("/api/v1/change-log/**").authenticated()
                        // No actuator endpoints are exposed this phase
                        // (spring-boot-starter-actuator isn't a dependency
                        // yet) — add a permitAll matcher here if/when one is
                        // introduced, per security-architecture.md §10.
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(restAuthenticationEntryPoint)
                        .accessDeniedHandler(restAccessDeniedHandler))
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(authRateLimitFilter, JwtAuthenticationFilter.class)
                // After the JWT filter, so the principal exists to key the
                // per-user bucket on (security-architecture.md §11's default
                // tier). Covers every non-auth /api/v1/** endpoint, so
                // domains 3+ inherit it without adding a second mechanism.
                .addFilterAfter(apiRateLimitFilter, JwtAuthenticationFilter.class)
                // ADR 0027 §4.1 (BE-1): parse the four optional write headers
                // after the rate limiter, so a flood of malformed headers is
                // still counted against the caller's bucket.
                .addFilterAfter(new WriteContextFilter(apiErrorResponseWriter), ApiRateLimitFilter.class);

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
        // The four ADR 0027 §4.1 write headers are allowed for any future web
        // origin (security-architecture.md §6); the mobile app is not
        // CORS-governed.
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type",
                WriteContextFilter.IDEMPOTENCY_KEY, WriteContextFilter.CLIENT_UPDATED_AT,
                WriteContextFilter.CLIENT_ORIGIN, WriteContextFilter.DEVICE_ID));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
