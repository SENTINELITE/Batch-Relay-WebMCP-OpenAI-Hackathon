import { frozenDemoTemplateCatalog } from "@/lib/storefront/template-specs/frozen-demo";

export async function GET() {
  return Response.json(frozenDemoTemplateCatalog(), { headers: { "Cache-Control": "no-store" } });
}
