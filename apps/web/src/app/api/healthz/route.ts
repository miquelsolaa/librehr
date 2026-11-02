import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json({
    status: "ok",
    app: "librehr-web",
    timestamp: new Date().toISOString(),
  });
}
