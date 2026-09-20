"use client";

import { useEffect } from "react";
import { registerTools } from "@nekuda/webmcp-sdk";

import { creativeWebMcpTools } from "./tools";

/**
 * Registers the creative tool surface for the `/creative` page only. The
 * page's editor must mount this component alongside the visible workbench.
 * The editor owns bridge subscriptions; this component owns SDK lifetime.
 */
export function CreativeWebMcpRegistrar() {
  useEffect(() => {
    // The installed 0.5.0 SDK exposes anonymous usage telemetry through this
    // option; it does not expose the newer `tracking.builtWith` field.
    const registration = registerTools(creativeWebMcpTools, { telemetry: true });
    return () => registration.unregister();
  }, []);

  return null;
}
