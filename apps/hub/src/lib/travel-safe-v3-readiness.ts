import { z } from "zod";

const readinessSchema = z.object({ status: z.literal("ready") });

function endpoint(sponsorUrl: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL("v3/readyz", base).toString();
}

export async function inspectTravelSafeV3Sponsor(input: {
  sponsorUrl: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(endpoint(input.sponsorUrl), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("The private relay could not be reached");
  }
  if (!response.ok) {
    throw new Error("Private parking is temporarily unavailable");
  }
  if (!readinessSchema.safeParse(await response.json()).success) {
    throw new Error("The private relay returned an invalid readiness check");
  }
}
