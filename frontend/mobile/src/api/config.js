import { NativeModules } from 'react-native';

/**
 * API configuration — docs/decisions/0016-frontend-api-integration.md §2.
 *
 * This is the ONLY file that decides where the backend lives. Everything
 * else in src/api/ asks this module. That containment is deliberate: when a
 * real production environment (or a .env / build-flavor scheme) eventually
 * exists, it is a one-file change here rather than a hunt through the
 * transport layer.
 *
 * Layer rule (ADR 0016 §1): this file may import from `react-native` only.
 * It must never import React, a store, or another api/ module.
 *
 * ---
 * CLEARTEXT (http://) IN DEVELOPMENT — checked against this project's actual
 * native config, because ADR 0016 §2 flags it as an afternoon-sized trap.
 * **No native change was needed on either platform; do not "fix" this.**
 *
 * - Android: `AndroidManifest.xml` already carries
 *   `android:usesCleartextTraffic="${usesCleartextTraffic}"`, and React
 *   Native's own Gradle plugin sets that placeholder to `true` for the debug
 *   build types and `false` for release. Debug therefore already permits
 *   cleartext to any host, including a LAN IP; release already blocks it.
 *   There is no `network_security_config.xml` in this project, and adding one
 *   would NARROW what debug currently allows.
 * - iOS: `Info.plist` already sets `NSAllowsArbitraryLoads=false` with
 *   `NSAllowsLocalNetworking=true`, which permits cleartext to localhost and
 *   to private/link-local (RFC 1918) addresses — i.e. exactly a dev machine's
 *   LAN IP — without opening up public cleartext.
 *
 * Production remains HTTPS-only (security-architecture.md §6): PROD_API_BASE_URL
 * must be an https:// URL, and release builds block cleartext regardless.
 */

// 1. Explicit local override for a developer's own machine.
//    MUST remain null in committed source (ADR 0016 §2) — any diff that sets
//    this to a real value is a review blocker. Set it locally (and revert
//    before committing) when testing on a physical Android device over
//    `adb reverse`, where neither the Metro-derived host nor the platform
//    fallback below can produce a reachable address.
const DEV_API_HOST_OVERRIDE = null;

// 2. Production base URL. No deployed backend exists yet (ADR 0016 §2 /
//    "Out of scope"). Deliberately null so a release build fails loudly
//    instead of silently pointing at nothing. Must be https:// when it is
//    filled in — docs/architecture/security-architecture.md §6.
const PROD_API_BASE_URL = null;

const API_PORT = 8080;
const API_PREFIX = '/api/v1';

/** Default request timeout. Mobile networks: long enough not to false-positive
 *  on a slow connection, short enough that a dead backend doesn't hang the UI
 *  indefinitely (ADR 0016 §3.1). */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Logout must not make the user wait on a dead network (ADR 0016 §6.4). */
export const LOGOUT_TIMEOUT_MS = 5000;

/** Refresh this long before the access token actually expires (ADR 0016 §6.2). */
export const REFRESH_SKEW_MS = 60000;

export const AUTH_PATHS = {
  register: '/auth/register',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  forgotPassword: '/auth/forgot-password',
};

/**
 * Pulls the host out of a URL without relying on a full URL parser (React
 * Native's `URL` implementation is partial and platform-dependent).
 *
 * @param {string | undefined | null} url e.g. 'http://192.168.1.5:8081/index.bundle?platform=android'
 * @returns {string | null} e.g. '192.168.1.5'
 */
function parseHost(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const match = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/:?#]+)/);
  return match ? match[1] : null;
}

/**
 * Reads Metro's bundle URL.
 *
 * Under the New Architecture `SourceCode` is a TurboModule, so its constants
 * may be exposed either directly on the NativeModules proxy or only through
 * `getConstants()` depending on how the module is reached. Both are tried;
 * if neither is available the caller falls back to the platform default,
 * which is the correct answer on an emulator/simulator anyway.
 *
 * @returns {string | null}
 */
function readMetroScriptUrl() {
  const sourceCode = NativeModules?.SourceCode;
  if (!sourceCode) {
    return null;
  }
  if (typeof sourceCode.scriptURL === 'string') {
    return sourceCode.scriptURL;
  }
  if (typeof sourceCode.getConstants === 'function') {
    return sourceCode.getConstants()?.scriptURL || null;
  }
  return null;
}

/**
 * Dev-only host resolution (ADR 0016 §2).
 *
 * `NativeModules.SourceCode.scriptURL` in a dev build is the Metro bundler
 * URL. The device is *already* talking to the dev machine over that address —
 * that is how it got its JS bundle — so for a physical device it is, by
 * construction, a reachable LAN IP obtained at runtime and never committed.
 *
 * When Metro is reached through `adb reverse` (the default for
 * `react-native run-android`) the host is `localhost`, which says nothing
 * about where the API is; that is exactly the case the platform fallback
 * covers. The one case neither covers — a physical Android device over
 * `adb reverse` — is what DEV_API_HOST_OVERRIDE exists for.
 */
function resolveDevHost() {
  const metroHost = parseHost(readMetroScriptUrl());
  if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1') {
    return metroHost;
  }
  // Metro resolving to localhost means the bundle arrived through an adb
  // tunnel (`adb reverse tcp:8081`), which react-native run-android sets up
  // for emulators *and* physical devices alike. The same tunnel mechanism
  // carries the API port, so `localhost` is correct for both — provided
  // `adb reverse tcp:8080 tcp:8080` has been run (see backend/README.md).
  //
  // This deliberately does NOT return Android's 10.0.2.2 here. That address
  // is the *emulator's* alias for the host machine and is unroutable on a
  // physical device, so returning it produced a request that hung until the
  // timeout instead of failing fast — the exact symptom seen on 2026-09-13.
  // An emulator running without the API port forwarded is the one case that
  // still needs DEV_API_HOST_OVERRIDE = '10.0.2.2'.
  return 'localhost';
}

/**
 * @returns {string} Base URL including the /api/v1 prefix, no trailing slash.
 * @throws {Error} In a release build with no PROD_API_BASE_URL configured.
 */
export function getApiBaseUrl() {
  if (!__DEV__) {
    if (!PROD_API_BASE_URL) {
      throw new Error('No production API base URL is configured.');
    }
    return PROD_API_BASE_URL;
  }
  const host = DEV_API_HOST_OVERRIDE || resolveDevHost();
  return `http://${host}:${API_PORT}${API_PREFIX}`;
}

/**
 * @param {string} path A leading-slash path relative to the API prefix, e.g. '/auth/login'.
 * @returns {string}
 */
export function buildUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}
