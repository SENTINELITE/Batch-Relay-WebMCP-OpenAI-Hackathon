"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  type CatalogProduct,
  type IngestedAsset,
  type PublishedTemplate,
  type ProviderOffer,
  type SandboxOrder,
  type SandboxQuote,
  type TemplateContract,
  type TemplateOutput,
  type TemplateRender,
  storefrontClient,
} from "@/lib/storefront/client";
import {
  publishStorefrontWebMcpState,
  respondToStorefrontWebMcpAction,
  subscribeToStorefrontWebMcpActions,
} from "@/webmcp/storefront-bridge";

type Notice = { tone: "error" | "info"; message: string } | null;
type ActiveStep = "catalog" | "prepare" | "review";
type AddressDraft = {
  name: string;
  address_1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
};
type CartLine = {
  id: string;
  product: CatalogProduct;
  asset: IngestedAsset;
  offer: ProviderOffer;
  quantity: number;
  source: "direct" | "template";
  template?: PublishedTemplate;
  templateRenderId?: string;
  fulfillmentRole: "artwork" | "front" | "back";
};

const blankAddress = (): AddressDraft => ({
  name: "", address_1: "", city: "", state: "", postal_code: "", country: "US", phone: "",
});
const cropFor = (product: CatalogProduct): "5:7" | "4:5" => product.id === "print-5x7" ? "5:7" : "4:5";
const productSize = (product: CatalogProduct) => product.physical_output
  ? `${product.physical_output.width} × ${product.physical_output.height} in`
  : "Print format";
const responseMessage = (error: unknown) => error instanceof Error
  ? error.message
  : "The public API request could not be completed.";
const completeAddress = (address: AddressDraft) =>
  (["name", "address_1", "city", "state", "postal_code", "country", "phone"] as const)
    .every((field) => address[field].trim().length > 0);

function AddressFields({ title, value, onChange }: {
  title: string;
  value: AddressDraft;
  onChange: (value: AddressDraft) => void;
}) {
  const fields = ["name", "address_1", "city", "state", "postal_code", "country", "phone"] as const;
  return <fieldset className="address-fields"><legend>{title}</legend>{fields.map((field) => (
    <label className="field-label" key={field}>{field.replace("_", " ")}<input
      value={value[field]}
      onChange={(event) => onChange({ ...value, [field]: event.target.value })}
      placeholder={field === "phone" ? "+15555555555" : undefined}
    /></label>
  ))}</fieldset>;
}

export function ManualStorefront() {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [step, setStep] = useState<ActiveStep>("catalog");
  const [notice, setNotice] = useState<Notice>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [localImage, setLocalImage] = useState<File | null>(null);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropZoom, setCropZoom] = useState(1);
  const [sourceUrl, setSourceUrl] = useState("");
  const [managedAsset, setManagedAsset] = useState<IngestedAsset | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [offers, setOffers] = useState<ProviderOffer[]>([]);
  const [offerState, setOfferState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [templateState, setTemplateState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateOutput, setTemplateOutput] = useState<TemplateOutput | null>(null);
  const [templateContract, setTemplateContract] = useState<TemplateContract | null>(null);
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [templateRender, setTemplateRender] = useState<TemplateRender | null>(null);
  const [rendering, setRendering] = useState(false);
  const [customization, setCustomization] = useState<"direct" | "template">("direct");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<SandboxQuote | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<Record<string, unknown> | null>(null);
  const [sandboxOrder, setSandboxOrder] = useState<SandboxOrder | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sandboxSessionReady, setSandboxSessionReady] = useState(false);
  const [shipTo, setShipTo] = useState<AddressDraft>(blankAddress);
  const [shipFrom, setShipFrom] = useState<AddressDraft>(blankAddress);
  const [customerEmail, setCustomerEmail] = useState("");
  const [shippingService, setShippingService] = useState("economy");
  const fileUrl = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    storefrontClient.catalog().then((response) => {
      if (!live) return;
      setCatalog(response.products.filter((product) =>
        ["print-5x7", "print-8x10"].includes(product.id) && product.fulfillment_type === "print"));
      setCatalogState("ready");
    }).catch((error: unknown) => {
      if (!live) return;
      setCatalogState("error");
      setNotice({ tone: "error", message: `Catalog unavailable: ${responseMessage(error)}` });
    });
    return () => { live = false; };
  }, []);

  useEffect(() => () => { if (fileUrl.current) URL.revokeObjectURL(fileUrl.current); }, []);

  const selectedProduct = useMemo(
    () => catalog.find((product) => product.id === selectedProductId) ?? null,
    [catalog, selectedProductId],
  );
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const crop = selectedProduct ? cropFor(selectedProduct) : "4:5";
  const renderArtifact = templateRender?.status === "succeeded" ? templateRender.artifacts[0] : undefined;
  const canUseTemplate = selectedProduct?.template_requirement !== "unsupported";

  function selectProduct(product: CatalogProduct) {
    setSelectedProductId(product.id);
    setManagedAsset(null);
    setSelectedTemplateId("");
    setTemplateRender(null);
    setTemplateContract(null);
    setTemplateOutput(null);
    setTemplateInputs({});
    setQuote(null);
    setSandboxOrder(null);
    setStep("prepare");
    setNotice(null);
    setOffers([]);
    setOfferState("loading");
    setSelectedOfferId("");
    storefrontClient.offers(product.id).then((result) => {
      const available = result.offers.filter((offer) =>
        offer.availability === "available" && offer.provider_id === "whcc");
      setOffers(available);
      setOfferState("ready");
      if (available.length > 0) setSelectedOfferId(available[0].id);
      else setNotice({ tone: "info", message: "The API returned no available provider offer for this product, so it cannot enter sandbox review." });
    }).catch((error: unknown) => {
      setOfferState("error");
      setNotice({ tone: "error", message: `Offer evidence unavailable: ${responseMessage(error)}` });
    });
    if (product.template_requirement === "required") setCustomization("template");
  }

  function chooseLocalImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    fileUrl.current = URL.createObjectURL(file);
    setImagePreview(fileUrl.current);
    setImageName(file.name);
    setLocalImage(file);
    setCropX(50);
    setCropY(50);
    setCropZoom(1);
    setManagedAsset(null);
    setTemplateRender(null);
    setNotice({ tone: "info", message: "Adjust the crop, then upload the prepared bytes through Batch Relay's published studio asset session." });
  }

  async function croppedFile(file: File, ratio: number): Promise<{ file: File; width: number; height: number }> {
    const bitmap = await createImageBitmap(file);
    try {
      const sourceRatio = bitmap.width / bitmap.height;
      let baseWidth = bitmap.width;
      let baseHeight = bitmap.height;
      if (sourceRatio > ratio) baseWidth = bitmap.height * ratio;
      else baseHeight = bitmap.width / ratio;
      const width = baseWidth / cropZoom;
      const height = baseHeight / cropZoom;
      const left = (bitmap.width - width) * (cropX / 100);
      const top = (bitmap.height - height) * (cropY / 100);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot prepare the selected image.");
      context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The crop could not be encoded.")), "image/jpeg", 0.94));
      const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
      return {
        file: new File([blob], `${baseName}-${crop.replace(":", "x")}.jpg`, { type: "image/jpeg" }),
        width: canvas.width,
        height: canvas.height,
      };
    } finally { bitmap.close(); }
  }

  async function prepareLocalImage() {
    if (!localImage || !selectedProduct) return;
    setPreparing(true);
    setNotice(null);
    try {
      const prepared = await croppedFile(localImage, crop === "5:7" ? 5 / 7 : 4 / 5);
      const uploaded = await storefrontClient.uploadStudioAsset(prepared.file);
      setManagedAsset({
        asset_id: uploaded.asset_id,
        pixel_width: prepared.width,
        pixel_height: prepared.height,
        format: "jpeg",
        original_filename: prepared.file.name,
        reused: false,
      });
      setTemplateRender(null);
      setNotice({ tone: "info", message: `Prepared ${prepared.width} × ${prepared.height}px through the published studio asset API.` });
    } catch (error) {
      setNotice({ tone: "error", message: `Image preparation failed: ${responseMessage(error)}` });
    } finally { setPreparing(false); }
  }

  async function ingestRemoteImage() {
    if (!sourceUrl.trim()) {
      setNotice({ tone: "error", message: "Enter the HTTPS image URL Batch Relay should ingest." });
      return;
    }
    setPreparing(true);
    setNotice(null);
    try {
      if (!sandboxSessionReady) {
        await storefrontClient.createSandboxSession();
        setSandboxSessionReady(true);
      }
      const asset = await storefrontClient.ingestAsset(sourceUrl.trim());
      setManagedAsset(asset);
      setTemplateRender(null);
      setNotice({ tone: "info", message: `Managed image ready: ${asset.pixel_width} × ${asset.pixel_height}px.` });
    } catch (error) {
      setNotice({ tone: "error", message: `Image preparation failed: ${responseMessage(error)}` });
    } finally { setPreparing(false); }
  }

  async function discoverTemplates() {
    setTemplateState("loading");
    setNotice(null);
    try {
      const result = await storefrontClient.templates();
      setTemplates(result.items);
      setTemplateState("ready");
      if (result.items.length === 0) setNotice({ tone: "info", message: "The API returned no active templates for the server-configured studio." });
    } catch (error) {
      setTemplateState("error");
      setNotice({ tone: "error", message: `Published templates unavailable: ${responseMessage(error)}. No templates are substituted locally.` });
    }
  }

  async function chooseTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    setTemplateContract(null);
    setTemplateOutput(null);
    setTemplateRender(null);
    setTemplateInputs({});
    if (!templateId || !selectedProduct) return;
    setTemplateState("loading");
    setNotice(null);
    try {
      const outputs = await storefrontClient.templateOutputs(templateId);
      const compatible = outputs.outputs.find((output) => output.products.some((product) =>
        product.canonical_product_id === selectedProduct.id &&
        product.canonical_product_revision === selectedProduct.revision));
      if (!compatible) throw new Error(`The template has no published ${selectedProduct.name} output.`);
      const contract = await storefrontClient.templateContract(templateId, compatible.id, outputs.revision_id);
      setTemplateOutput(compatible);
      setTemplateContract(contract);
      setTemplateState("ready");
      setNotice({ tone: "info", message: `Loaded ${contract.slots.length} stable slot${contract.slots.length === 1 ? "" : "s"} from the published output contract.` });
    } catch (error) {
      setTemplateState("error");
      setNotice({ tone: "error", message: `Template contract unavailable: ${responseMessage(error)}` });
    }
  }

  async function runTemplateRender(overrideInputs?: Record<string, { asset_id: string } | { value: string }>) {
    if (!selectedTemplate || !templateContract || !templateOutput || !managedAsset) {
      throw new Error("Choose a compatible published template and prepare an image first.");
    }
    const inputs = overrideInputs ?? Object.fromEntries(templateContract.slots.map((slot) => [
      slot.key,
      slot.kind === "image" ? { asset_id: managedAsset.asset_id } : { value: templateInputs[slot.key] ?? "" },
    ]));
    const slotKeys = new Set(templateContract.slots.map((slot) => slot.key));
    if (Object.keys(inputs).some((key) => !slotKeys.has(key))) {
      throw new Error("Template inputs must use only stable keys from the visible published contract.");
    }
    for (const slot of templateContract.slots) {
      const input = inputs[slot.key];
      if (input && slot.kind === "image" && (!("asset_id" in input) || input.asset_id !== managedAsset.asset_id)) {
        throw new Error("Template image inputs must use the managed image selected in the visible storefront.");
      }
      if (input && slot.kind === "text" && !("value" in input)) {
        throw new Error("Template text inputs must provide a text value.");
      }
    }
    for (const slot of templateContract.slots.filter((candidate) => candidate.required)) {
      const input = inputs[slot.key];
      if (!input || ("value" in input && input.value.length === 0)) {
        throw new Error(`Complete the required ${slot.suggested_label ?? slot.kind} slot.`);
      }
    }
    setRendering(true);
    setNotice(null);
    try {
      let result = await storefrontClient.createTemplateRender(selectedTemplate.id, {
        revision_id: templateContract.template.revision_id,
        output_id: templateOutput.id,
        inputs,
      });
      for (let attempt = 0; attempt < 15 && ["queued", "running"].includes(result.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        result = await storefrontClient.templateRender(result.render_id);
      }
      setTemplateRender(result);
      if (result.status !== "succeeded" || result.artifacts.length !== 1) {
        throw new Error(`Batch Relay render ${result.render_id} is ${result.status} with ${result.artifacts.length} artifacts; this single-surface print requires exactly one.`);
      }
      setNotice({ tone: "info", message: `Render ${result.render_id} succeeded with ${result.artifacts.length} fulfillment artifact${result.artifacts.length === 1 ? "" : "s"}. The public API does not expose artifact bytes for an inline PNG preview.` });
      return result;
    } catch (error) {
      setNotice({ tone: "error", message: `Template render failed: ${responseMessage(error)}` });
      throw error;
    } finally { setRendering(false); }
  }

  function addPreparedLine(quantity = 1) {
    if (!selectedProduct || !selectedOffer) throw new Error("Choose a returned provider offer first.");
    const directAsset = customization === "direct" ? managedAsset : null;
    const artifact = customization === "template" ? renderArtifact : null;
    if (!directAsset && !artifact) {
      throw new Error(customization === "template"
        ? "Complete a successful published template render before adding this line."
        : "Prepare a managed image before adding this line.");
    }
    const asset: IngestedAsset = directAsset ?? {
      asset_id: artifact!.asset_id,
      pixel_width: artifact!.pixel_width,
      pixel_height: artifact!.pixel_height,
      format: "rendered",
      original_filename: `${artifact!.surface_id}.png`,
      reused: false,
    };
    const requiredRole = selectedProduct.asset_requirements[0]?.role;
    const fulfillmentRole = artifact?.fulfillment_role ??
      (["artwork", "front", "back"].includes(requiredRole) ? requiredRole as "artwork" | "front" | "back" : null);
    if (!fulfillmentRole) throw new Error("The selected product does not publish a supported fulfillment artwork role.");
    const line: CartLine = {
      id: crypto.randomUUID(),
      product: selectedProduct,
      asset,
      offer: selectedOffer,
      quantity,
      source: customization,
      template: customization === "template" ? selectedTemplate : undefined,
      templateRenderId: customization === "template" ? templateRender?.render_id : undefined,
      fulfillmentRole,
    };
    setCart((items) => [...items, line]);
    setQuote(null);
    setSandboxOrder(null);
    setStep("review");
    setNotice({ tone: "info", message: "Added to this browser's local cart. Nothing has been ordered or charged." });
    return line;
  }

  function buildQuoteRequest() {
    if (cart.length === 0) throw new Error("Add a print before requesting a sandbox quote.");
    if (!completeAddress(shipTo) || !completeAddress(shipFrom) || !customerEmail.trim()) {
      throw new Error("Complete both addresses and customer email. No address is fabricated.");
    }
    const provider = cart[0].offer.provider_id;
    if (cart.some((line) => line.offer.provider_id !== provider)) {
      throw new Error("All cart lines must use one returned provider for this sandbox quote.");
    }
    return {
      routing: { mode: "single_provider", provider_id: provider },
      order: {
        schema_version: 1,
        external_order_id: `webmcp-${crypto.randomUUID()}`,
        customer: { email: customerEmail.trim() },
        ship_to: shipTo,
        ship_from: shipFrom,
        shipping_service: shippingService,
        items: cart.map((line) => ({
          product: { id: line.product.id, revision: line.product.revision },
          quantity: line.quantity,
          options: Object.entries(line.offer.configuration).map(([option_id, value]) => ({ option_id, value })),
          assets: [{
            role: line.fulfillmentRole,
            asset_id: line.asset.asset_id,
            ...(line.templateRenderId ? { template_render_id: line.templateRenderId } : {}),
          }],
        })),
      },
    };
  }

  async function requestSandboxReview() {
    setQuoting(true);
    setNotice(null);
    try {
      const request = buildQuoteRequest();
      if (!sandboxSessionReady) {
        await storefrontClient.createSandboxSession();
        setSandboxSessionReady(true);
      }
      const result = await storefrontClient.quote(request);
      setQuote(result);
      setQuoteRequest(request as unknown as Record<string, unknown>);
      setSandboxOrder(null);
      setNotice({ tone: "info", message: "Sandbox quote ready. It is time-limited and is not a payment authorization." });
      return result;
    } catch (error) {
      setNotice({ tone: "error", message: `Sandbox review could not be created: ${responseMessage(error)}` });
      throw error;
    } finally { setQuoting(false); }
  }

  async function placeSandboxOrder() {
    const order = quoteRequest?.order;
    if (!quote || !order) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await storefrontClient.submitSandboxOrder({ quote_id: quote.id, integration_source: "custom_code", order });
      setSandboxOrder(result);
      setNotice({ tone: "info", message: `No-charge sandbox order ${result.order_code} was accepted by Batch Relay. No production order or payment was created.` });
    } catch (error) {
      setNotice({ tone: "error", message: `Sandbox order could not be created: ${responseMessage(error)}` });
    } finally { setSubmitting(false); }
  }

  useEffect(() => {
    publishStorefrontWebMcpState({
      revision: 1,
      canPreparePrintImages: Boolean(selectedProduct),
      canRenderTemplatePreview: Boolean(selectedTemplate && templateContract && templateOutput && managedAsset),
      canAddToCart: Boolean(selectedProduct && selectedOffer && (customization === "direct" ? managedAsset : renderArtifact)),
      cartItemCount: cart.length,
    });
  }, [cart.length, customization, managedAsset, renderArtifact, selectedOffer, selectedProduct, selectedTemplate, templateContract, templateOutput]);

  useEffect(() => subscribeToStorefrontWebMcpActions((request) => {
    void (async () => {
      try {
        if (request.action === "ask_storefront") {
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            answer: "This storefront exposes the live 5 × 7 and 8 × 10 public catalog, real managed assets, published studio template contracts, a local cart, and no-charge sandbox quotes/orders. Generic shopper payment and production checkout are not published by the Batch Relay public API and remain disabled.",
            selectedProductId,
            cartItemCount: cart.length,
            sandboxQuoteId: quote?.id ?? null,
            sandboxOrderId: sandboxOrder?.id ?? null,
          } });
          return;
        }
        if (request.action === "find_prints") {
          const query = String(request.input.query ?? request.input.productType ?? "").toLowerCase();
          const max = Math.min(Number(request.input.maxResults ?? 50), 50);
          const matches = catalog.filter((product) =>
            !query || `${product.id} ${product.name} ${product.description}`.toLowerCase().includes(query)).slice(0, max);
          setStep("catalog");
          setNotice({ tone: "info", message: `WebMCP found ${matches.length} matching live catalog product${matches.length === 1 ? "" : "s"}.` });
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: matches.map(({ id, revision, name, physical_output }) => ({ id, revision, name, physical_output })) });
          return;
        }
        if (request.action === "prepare_print_images") {
          const productId = typeof request.input.productId === "string" ? request.input.productId : selectedProductId;
          const product = catalog.find((candidate) => candidate.id === productId);
          if (product && product.id !== selectedProductId) selectProduct(product);
          else setStep("prepare");
          const imageIds = Array.isArray(request.input.imageIds) ? request.input.imageIds : [];
          const ready = Boolean(managedAsset && imageIds.includes(managedAsset.asset_id));
          setNotice({ tone: "info", message: ready ? "The requested managed image is ready in the visible preparation step." : "Select or upload the requested image in the visible preparation step." });
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: ready ? { status: "ready", asset_id: managedAsset!.asset_id } : { status: "needs_visible_image_selection" } });
          return;
        }
        if (request.action === "render_template_preview") {
          if (request.input.templateId !== selectedTemplate?.id) throw new Error("Choose that template in the visible storefront first.");
          if (request.input.revisionId && request.input.revisionId !== templateContract?.template.revision_id) throw new Error("The requested revision is not the visible published contract revision.");
          if (request.input.outputId && request.input.outputId !== templateOutput?.id) throw new Error("The requested output is not the visible compatible output.");
          const inputs = request.input.inputs as Record<string, { asset_id: string } | { value: string }> | undefined;
          if (inputs) setTemplateInputs(Object.fromEntries(Object.entries(inputs).flatMap(([key, value]) => "value" in value ? [[key, value.value]] : [])));
          const result = await runTemplateRender(inputs);
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: { render_id: result.render_id, status: result.status, artifacts: result.artifacts } });
          return;
        }
        if (request.action === "add_to_cart") {
          if (request.input.productId !== selectedProductId) throw new Error("Select that product in the visible storefront first.");
          if (request.input.offerId && request.input.offerId !== selectedOffer?.id) throw new Error("Choose that returned offer in the visible storefront first.");
          const line = addPreparedLine(Number(request.input.quantity ?? 1));
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: { item_id: line.id, cart_item_count: cart.length + 1 } });
          return;
        }
        if (request.action === "manage_cart") {
          const action = request.input.action;
          const itemId = request.input.itemId;
          if (action === "clear") setCart([]);
          else if (action === "remove") setCart((items) => items.filter((line) => line.id !== itemId));
          else if (action === "update_quantity") setCart((items) => items.map((line) =>
            line.id === itemId ? { ...line, quantity: Number(request.input.quantity) } : line));
          setStep("review");
          setQuote(null);
          setSandboxOrder(null);
          const result = action === "view" ? cart.map((line) => ({ item_id: line.id, product_id: line.product.id, quantity: line.quantity })) : { status: "updated", action, item_id: itemId ?? null };
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result });
          return;
        }
        setStep("review");
        if (typeof request.input.shippingPostalCode === "string") {
          setShipTo((address) => ({ ...address, postal_code: request.input.shippingPostalCode as string }));
        }
        const ready = completeAddress(shipTo) && completeAddress(shipFrom) && Boolean(customerEmail.trim());
        if (!ready) {
          setNotice({ tone: "info", message: "Complete the visible shipping and contact fields to request a real sandbox quote. No values are inferred." });
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: { status: "needs_visible_shipping_form", cartItemCount: cart.length } });
          return;
        }
        const result = await requestSandboxReview();
        respondToStorefrontWebMcpAction({ requestId: request.requestId, result: { status: "quoted", quote_id: result.id, expires_at: result.expires_at } });
      } catch (error) {
        respondToStorefrontWebMcpAction({ requestId: request.requestId, error: responseMessage(error) });
      }
    })();
  }));

  return <main className="workbench-shell">
    <header className="masthead"><a className="wordmark" href="#catalog" aria-label="Batch Relay print workbench home"><span className="wordmark-mark" aria-hidden="true" />Batch Relay <em>Print workbench</em></a><div className="masthead-meta"><span className="environment-chip">Public API · Test Mode</span><a href="#review">Local cart <b>{cart.length}</b></a></div></header>
    <section className="intro" aria-labelledby="page-title"><div><p className="eyebrow">An API-backed print flow</p><h1 id="page-title">Frame the image.<br /><i>Keep the proof.</i></h1><p className="lede">Choose a live Batch Relay print, prepare real managed artwork, optionally render a published studio template, and create a no-charge sandbox order. Production payment stays closed until the public API publishes a shopper checkout contract.</p></div><aside className="process-key" aria-label="Preparation sequence"><span><b>01</b> Select format</span><span><b>02</b> Prepare image</span><span><b>03</b> Review sandbox</span></aside></section>
    <nav className="stepper" aria-label="Storefront progress">{(["catalog", "prepare", "review"] as const).map((item, index) => <button key={item} type="button" className={step === item ? "is-current" : ""} onClick={() => setStep(item)} disabled={(item === "prepare" && !selectedProduct) || (item === "review" && cart.length === 0)}><span>0{index + 1}</span> {item === "catalog" ? "Format" : item === "prepare" ? "Prepare" : "Review"}</button>)}</nav>
    {notice && <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</div>}

    {step === "catalog" && <section id="catalog" className="catalog-section" aria-labelledby="catalog-title"><div className="section-heading"><p className="eyebrow">Live canonical catalog</p><h2 id="catalog-title">Choose a print ratio.</h2><p>Only the requested active 5 × 7 and 8 × 10 products are shown. Retail prices are omitted; returned provider costs are evidence, not shopper prices.</p></div>{catalogState === "loading" && <p className="loading-line">Reading the public catalog…</p>}{catalogState === "error" && <p className="empty-line">The catalog could not be read. The API error is above.</p>}{catalogState === "ready" && catalog.length === 0 && <p className="empty-line">Neither requested product is active in the public catalog.</p>}<div className="product-rail">{catalog.map((product) => <button className="product-ticket" type="button" key={product.id} onClick={() => selectProduct(product)}><span className={`ratio-stamp ratio-${cropFor(product).replace(":", "-")}`} aria-hidden="true"><i /></span><span className="ticket-number">{cropFor(product) === "5:7" ? "5 : 7" : "4 : 5"}</span><strong>{product.name}</strong><small>{productSize(product)} · revision {product.revision}</small><span className="ticket-action">Prepare this format <b>→</b></span></button>)}</div></section>}

    {step === "prepare" && selectedProduct && <section id="prepare" className="prepare-section" aria-labelledby="prepare-title"><div className="prepare-header"><div><p className="eyebrow">Selected live format</p><h2 id="prepare-title">{selectedProduct.name}</h2><p>{selectedProduct.description}</p></div><button className="quiet-action" type="button" onClick={() => setStep("catalog")}>Change format</button></div><div className="preparation-grid">
      <div className="crop-station"><div className={`contact-sheet crop-${crop.replace(":", "-")}`}><div className="registration tl" /><div className="registration tr" /><div className="registration bl" /><div className="registration br" />{imagePreview ? <Image src={imagePreview} alt="Selected image crop preview" fill unoptimized sizes="(max-width: 760px) 340px, 390px" style={{ objectFit: "cover", objectPosition: `${cropX}% ${cropY}%`, transform: `scale(${cropZoom})` }} /> : <div className="empty-crop"><span>Image contact sheet</span><b>{crop === "5:7" ? "5 × 7" : "8 × 10"}</b></div>}<span className="crop-label">Crop frame · {crop === "5:7" ? "5 : 7" : "4 : 5"}</span></div><p className="crop-caption">The frame is a local crop aid. “Prepare local crop” creates those pixels and uploads them through the published studio asset session. It is not a provider proof.</p></div>
      <div className="prep-controls">
        <fieldset><legend>1. Prepare artwork</legend><label className="file-control"><input type="file" accept="image/jpeg,image/png" onChange={chooseLocalImage} /><span>{imageName ?? "Choose a JPEG or PNG"}</span><b>Browse</b></label>{localImage && <div className="crop-controls"><label className="field-label">Horizontal focus <input type="range" min="0" max="100" value={cropX} onChange={(event) => setCropX(Number(event.target.value))} /></label><label className="field-label">Vertical focus <input type="range" min="0" max="100" value={cropY} onChange={(event) => setCropY(Number(event.target.value))} /></label><label className="field-label">Zoom <input type="range" min="1" max="2" step="0.05" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} /></label><button className="ink-button full" type="button" onClick={prepareLocalImage} disabled={preparing}>{preparing ? "Preparing…" : "Prepare local crop"}</button></div>}<div className="source-divider"><span>or use managed ingest</span></div><label className="field-label" htmlFor="source-url">Routable HTTPS image URL</label><div className="url-row"><input id="source-url" type="url" inputMode="url" placeholder="https://…/image.jpg" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /><button className="ink-button" type="button" onClick={ingestRemoteImage} disabled={preparing}>{preparing ? "Preparing…" : "Ingest URL"}</button></div>{managedAsset && <p className="asset-proof">Managed asset <b>{managedAsset.asset_id}</b><span>{managedAsset.pixel_width} × {managedAsset.pixel_height}px</span></p>}</fieldset>
        <fieldset><legend>2. Choose artwork path</legend><div className="choice-grid"><button type="button" className={customization === "direct" ? "choice is-selected" : "choice"} disabled={selectedProduct.template_requirement === "required"} onClick={() => setCustomization("direct")}><b>Direct artwork</b><span>Use the prepared image as the product artwork.</span></button><button type="button" className={customization === "template" ? "choice is-selected" : "choice"} disabled={!canUseTemplate} onClick={() => setCustomization("template")}><b>Published template</b><span>Use a real studio output contract and render job.</span></button></div></fieldset>
        {customization === "template" && <fieldset className="template-fieldset"><legend>Published studio template</legend><button className="ink-button" type="button" onClick={discoverTemplates} disabled={templateState === "loading"}>{templateState === "loading" ? "Reading…" : "Read active templates"}</button>{templates.length > 0 && <label className="field-label">Template<select value={selectedTemplateId} onChange={(event) => void chooseTemplate(event.target.value)}><option value="">Select a returned template</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name ?? template.id}</option>)}</select></label>}{templateContract && <div className="slot-list"><p className="microcopy">Compatible output: {templateOutput?.label ?? templateOutput?.id}. Image slots use the prepared managed image. Text uses the returned stable slot keys.</p>{templateContract.slots.map((slot) => slot.kind === "image" ? <p className="slot-proof" key={slot.key}><b>{slot.suggested_label ?? "Image"}</b><span>{slot.key} · {managedAsset ? managedAsset.asset_id : "prepare an image"}</span></p> : <label className="field-label" key={slot.key}>{slot.suggested_label ?? "Text"}{slot.required ? " *" : ""}<input maxLength={slot.max_length} value={templateInputs[slot.key] ?? ""} onChange={(event) => setTemplateInputs((values) => ({ ...values, [slot.key]: event.target.value }))} /><small>{slot.key}</small></label>)}<button className="ink-button full" type="button" onClick={() => void runTemplateRender().catch(() => undefined)} disabled={rendering || !managedAsset}>{rendering ? "Rendering…" : "Create real template render"}</button></div>}{templateRender && <p className="asset-proof">Render <b>{templateRender.render_id}</b><span>{templateRender.status}{renderArtifact ? ` · ${renderArtifact.pixel_width} × ${renderArtifact.pixel_height}px` : ""}</span></p>}<p className="microcopy">The public API returns fulfillment artifact metadata, but no readable artifact URL. This site does not invent an inline PNG preview.</p></fieldset>}
        <fieldset><legend>3. Returned provider offer</legend>{offerState === "loading" && <p className="microcopy">Reading live offer evidence…</p>}{offers.length > 0 && <label className="field-label">Available configuration<select value={selectedOfferId} onChange={(event) => setSelectedOfferId(event.target.value)}>{offers.map((offer) => <option value={offer.id} key={offer.id}>{offer.provider_id.toUpperCase()} · {Object.entries(offer.configuration).map(([key, value]) => `${key}: ${value}`).join(", ")} · provider cost {((offer.unit_cost_cents ?? 0) / 100).toFixed(2)} {offer.currency}</option>)}</select></label>}<p className="microcopy">Provider unit cost is API evidence, not a retail price.</p></fieldset>
        <button className="coral-button" type="button" onClick={() => { try { addPreparedLine(); } catch (error) { setNotice({ tone: "error", message: responseMessage(error) }); } }}>Add prepared line to local cart <span>→</span></button>
      </div>
    </div></section>}

    {step === "review" && <section id="review" className="review-section" aria-labelledby="review-title"><div className="section-heading"><p className="eyebrow">Sandbox review</p><h2 id="review-title">Nothing here can charge a card.</h2><p>The cart is local. A quote and optional no-charge sandbox order use Batch Relay Test Mode. Production checkout remains locked.</p></div><div className="review-grid"><div className="cart-paper">{cart.length === 0 ? <p className="empty-line">Your local cart is empty.</p> : <ol>{cart.map((line, index) => <li key={line.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{line.quantity} × {line.product.name}</b><small>{line.source === "template" ? `Rendered template · ${line.template?.name ?? line.template?.id}` : "Direct prepared artwork"}</small><small>{line.offer.provider_id.toUpperCase()} · {Object.values(line.offer.configuration).join(", ")} · asset {line.asset.asset_id}</small></div><button type="button" aria-label={`Remove ${line.product.name}`} onClick={() => { setCart((items) => items.filter((item) => item.id !== line.id)); setQuote(null); setSandboxOrder(null); }}>Remove</button></li>)}</ol>}<div className="address-desk"><p className="eyebrow">Published quote fields</p><p className="microcopy">The public order contract requires both address records. They are never inferred or fabricated.</p><label className="field-label">Customer email<input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="you@example.com" /></label><div className="address-columns"><AddressFields title="Ship from" value={shipFrom} onChange={setShipFrom} /><AddressFields title="Ship to" value={shipTo} onChange={setShipTo} /></div><label className="field-label">Shipping service<select value={shippingService} onChange={(event) => setShippingService(event.target.value)}><option value="economy">Economy</option><option value="economy_untracked">Economy untracked</option><option value="expedited">Expedited</option><option value="standard_one_day">Standard one day</option><option value="priority_one_day">Priority one day</option></select></label></div></div><aside className="sandbox-card"><span className="environment-chip">Test Mode only</span>{quote ? <div className="quote-result"><p>Quote reference</p><strong>{quote.id}</strong><small>Expires {new Date(quote.expires_at).toLocaleString()}</small>{typeof quote.price?.total_cents === "number" && <b>{quote.price.currency ?? "USD"} {(quote.price.total_cents / 100).toFixed(2)}</b>}</div> : <p>Shipping, tax, and totals come only from Batch Relay&apos;s sandbox quote response.</p>}<button className="ink-button full" type="button" onClick={() => void requestSandboxReview().catch(() => undefined)} disabled={cart.length === 0 || quoting}>{quoting ? "Creating quote…" : "Request sandbox quote"}</button>{quote && !sandboxOrder && <button className="coral-button" type="button" onClick={placeSandboxOrder} disabled={submitting}>{submitting ? "Submitting…" : "Place no-charge sandbox order"}</button>}{sandboxOrder && <div className="quote-result"><p>Sandbox order</p><strong>{sandboxOrder.order_code}</strong><small>{sandboxOrder.status} · {sandboxOrder.id}</small></div>}<div className="production-lock"><b>Production checkout is disabled</b><span>The public API does not publish a generic shopper payment or production checkout contract. This storefront will not imply one exists.</span></div></aside></div></section>}
    <footer><span>Batch Relay public API storefront</span><span>Real managed assets · real template contracts · sandbox only</span></footer>
  </main>;
}
