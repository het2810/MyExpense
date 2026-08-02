package com.myexpense.backend.config;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.myexpense.backend.sync.WriteContextArgumentResolver;

/**
 * Registers {@link WriteContextArgumentResolver} so controllers can take the
 * request's {@code WriteContext} (ADR 0027 §4.1) as a parameter.
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new WriteContextArgumentResolver());
    }
}
