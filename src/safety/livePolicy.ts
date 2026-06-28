import type { LiveActionDecision, LiveConfig, LiveElementSnapshot, LivePermissions } from "../types.js";

export interface LivePolicy {
  allowedOrigins: string[];
  permissions: LivePermissions;
  testData: Record<string, string>;
}

export interface SafetyCheckInput {
  action: LiveActionDecision;
  currentUrl: string;
  elements: LiveElementSnapshot[];
}

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  element?: LiveElementSnapshot;
  value?: string;
}

export function createLivePolicy(config: LiveConfig): LivePolicy {
  return {
    allowedOrigins: config.allowedOrigins.map((origin) => normalizeOrigin(origin)),
    permissions: config.permissions,
    testData: config.testData,
  };
}

export function isAllowedOrigin(value: string, allowedOrigins: string[]): boolean {
  const origin = normalizeOrigin(value);
  return allowedOrigins.includes(origin);
}

export function validateLiveAction(policy: LivePolicy, input: SafetyCheckInput): SafetyCheckResult {
  if (!isAllowedOrigin(input.currentUrl, policy.allowedOrigins)) {
    return { allowed: false, reason: `Current page origin is not allowed: ${normalizeOrigin(input.currentUrl)}` };
  }

  if (input.action.action === "finish" || input.action.action === "fail" || input.action.action === "observe") {
    return { allowed: true };
  }

  if (input.action.action === "scroll" || input.action.action === "wait" || input.action.action === "back") {
    return { allowed: true };
  }

  const element = input.elements.find((candidate) => candidate.id === input.action.targetId);
  if (!element) {
    return { allowed: false, reason: `Target element was not found: ${input.action.targetId ?? "missing"}` };
  }
  if (!element.visible || !element.enabled) {
    return { allowed: false, reason: `Target element is not visible and enabled: ${element.id}`, element };
  }

  if (input.action.action === "click") {
    if (!policy.permissions.allowClicks) {
      return { allowed: false, reason: "Clicks are disabled by live.permissions.allowClicks.", element };
    }
    if (element.isSubmit && !policy.permissions.allowFormSubmit) {
      return { allowed: false, reason: "Form submission is disabled by live.permissions.allowFormSubmit.", element };
    }
    if (element.isDestructive && !policy.permissions.allowDestructiveClicks) {
      return { allowed: false, reason: "Destructive-looking clicks are disabled by live.permissions.allowDestructiveClicks.", element };
    }
    if (element.href && !isAllowedOrigin(element.href, policy.allowedOrigins)) {
      return { allowed: false, reason: `Navigation target is outside live.allowedOrigins: ${element.href}`, element };
    }
    if (element.href && normalizeOrigin(element.href) !== normalizeOrigin(input.currentUrl) && !policy.permissions.allowExternalNavigation) {
      return { allowed: false, reason: `Cross-origin navigation is disabled: ${element.href}`, element };
    }
    return { allowed: true, element };
  }

  if (input.action.action === "type") {
    if (!policy.permissions.allowTyping) {
      return { allowed: false, reason: "Typing is disabled by live.permissions.allowTyping.", element };
    }
    if (!element.isInput) {
      return { allowed: false, reason: `Target element is not typable: ${element.id}`, element };
    }
    if (!input.action.valueKey || !(input.action.valueKey in policy.testData)) {
      return { allowed: false, reason: `Typed values must use configured live.testData keys: ${input.action.valueKey ?? "missing"}`, element };
    }
    return { allowed: true, element, value: policy.testData[input.action.valueKey] };
  }

  return { allowed: false, reason: `Unsupported action: ${input.action.action}` };
}

export function shouldBlockHttpRequest(value: string, policy: LivePolicy): boolean {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !isAllowedOrigin(value, policy.allowedOrigins);
}

export function shouldBlockNetworkRequest(value: string, method: string, policy: LivePolicy): boolean {
  const url = new URL(value);
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (!isAllowedOrigin(value, policy.allowedOrigins)) {
      return true;
    }
    if (!policy.permissions.allowFormSubmit && method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
      return true;
    }
    return false;
  }

  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") {
    return false;
  }

  return true;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}
