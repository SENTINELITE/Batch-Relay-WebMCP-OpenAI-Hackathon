"use client";

import { useEffect } from "react";
import { registerTools } from "@nekuda/webmcp-sdk";

import {
  addToCart,
  askStorefront,
  configurePrint,
  findPrints,
  manageCart,
  proposePrints,
  redoLastChange,
  resolveCartProposal,
  revisePrints,
  undoLastChange,
} from "../../webmcp/tools/storefront";

/** Optional WebMCP telemetry key. Registration stays local when it is unset. */
const trackingKey = process.env.NEXT_PUBLIC_WEBMCP_TRACKING_KEY;

/**
 * The published storefront tool surface. It is deliberately constant.
 *
 * An agent lists tools once and then plans a whole turn from that list, so
 * hiding a tool until its precondition happens to hold makes a legitimate
 * sequence unplannable: `configure_print` creates the first draft, but
 * `add_to_cart` would only appear afterwards, and the proposal card only makes
 * `resolve_cart_proposal` appear later still. Readiness is therefore enforced
 * inside each tool and by the visible workbench handler, which can say exactly
 * what is missing, instead of by the tool being absent.
 */
const storefrontTools = [
  askStorefront,
  findPrints,
  configurePrint,
  revisePrints,
  proposePrints,
  addToCart,
  resolveCartProposal,
  manageCart,
  undoLastChange,
  redoLastChange,
];

/** Registers the storefront tool surface once for the visible client flow. */
export function WebMcpRegistrar() {
  useEffect(() => {
    // Storefront tools stay entirely within the visible app's client flow.
    const registration = registerTools(
      storefrontTools,
      trackingKey ? { telemetry: true, tracking: { apiKey: trackingKey } } : undefined,
    );
    return () => registration.unregister();
  }, []);

  return null;
}
