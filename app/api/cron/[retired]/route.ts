import { retiredCronRouteResponse } from "@/utils/pick8-retired-routes";

// Static siblings (sync-fixtures, sync-results, reconcile-results) take precedence over this segment.
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ retired: string }> };

export async function GET(request: Request, { params }: Context) {
  return retiredCronRouteResponse((await params).retired, request.method);
}

export async function POST(request: Request, { params }: Context) {
  return retiredCronRouteResponse((await params).retired, request.method);
}
