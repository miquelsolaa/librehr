import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json({
    status: "ok",
    app: "openhr-web",
    timestamp: new Date().toISOString(),
  });
}
