"use client";

import { useEffect, useState } from "react";
import { registerTools } from "@nekuda/webmcp-sdk";

import {
  getStorefrontWebMcpState,
  subscribeToStorefrontWebMcpState,
  type StorefrontWebMcpState,
} from "../../webmcp/storefront-bridge";
import {
  addToCart,
  askStorefront,
  findPrints,
  manageCart,
  preparePrintImages,
  prepareSandboxOrder,
  renderTemplatePreview,
} from "../../webmcp/tools/storefront";

function availableTools(state: StorefrontWebMcpState) {
  return [
    askStorefront,
    findPrints,
    ...(state.canPreparePrintImages ? [preparePrintImages] : []),
    ...(state.canRenderTemplatePreview ? [renderTemplatePreview] : []),
    ...(state.canAddToCart ? [addToCart] : []),
    ...(state.cartItemCount > 0 ? [manageCart, prepareSandboxOrder] : []),
  ];
}

/**
 * Registers root storefront tools and re-registers contextual tools only while
 * their corresponding visible UI state is valid.
 */
export function WebMcpRegistrar() {
  const [state, setState] = useState<StorefrontWebMcpState>(() => getStorefrontWebMcpState());

  useEffect(() => subscribeToStorefrontWebMcpState(setState), []);

  useEffect(() => {
    // Storefront tools stay entirely within the visible app's client flow.
    // Do not opt this public storefront into SDK telemetry or third-party tracking.
    const registration = registerTools(availableTools(state), { telemetry: false });
    return () => registration.unregister();
  }, [state]);

  return null;
}
