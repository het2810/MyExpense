package com.myexpense.backend.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Getter;
import lombok.Setter;

/**
 * Auth token lifetime settings (docs/architecture/authentication.md §1/§4).
 * {@code secret} has no default here or in {@code application.properties} —
 * it is required via the {@code JWT_SECRET} environment variable
 * (constitution §13, no committed secret values).
 *
 * <p>{@code refreshTokenTtlDays} lives here too, even though the refresh
 * token itself is an opaque string, not a JWT — grouped under the same
 * {@code app.security.jwt.*} namespace as "the two auth-token lifetimes",
 * rather than introducing a second single-field properties class.
 */
@ConfigurationProperties(prefix = "app.security.jwt")
@Getter
@Setter
public class JwtProperties {

    private String secret;
    private long accessTokenTtlSeconds = 900;
    private int refreshTokenTtlDays = 30;
}
