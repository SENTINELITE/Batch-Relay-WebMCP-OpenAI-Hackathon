import { authConfigured, hasCreativeSession } from "@/lib/livepeer/auth";
import { errorResponse } from "@/lib/livepeer/errors";
import { creativeBudgetLimitUsd, hasDurableJournalConfiguration } from "@/lib/livepeer/journal";
import { isLivepeerConfigured } from "@/lib/livepeer/mcp";

export const runtime = "nodejs";

export async function GET() {
  try {
    const configured = isLivepeerConfigured() && authConfigured() && hasDurableJournalConfiguration();
    return Response.json({
      configured,
      authorized: configured && await hasCreativeSession(),
      budgetLimitUsd: creativeBudgetLimitUsd(),
      ...(configured ? {} : { message: "Creative generation is not configured for this server." }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
