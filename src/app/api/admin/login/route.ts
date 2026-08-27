import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, checkPassword, issueAdminCookie } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/admin?error=1", request.url), 303);
  }

  const cookie = issueAdminCookie();
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);

  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });

  return response;
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_COOKIE);
  return response;
}
