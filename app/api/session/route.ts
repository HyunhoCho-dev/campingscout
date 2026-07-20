import { NextResponse } from "next/server";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  return NextResponse.json({ user, signInUrl: chatGPTSignInPath("/"), signOutUrl: chatGPTSignOutPath("/") });
}
