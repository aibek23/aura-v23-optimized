import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const requestedNext = searchParams.get('next')
  // URL parsing normalizes backslashes and whitespace. Checking only "//"
  // allows paths such as "/\\external.example" to leave this origin.
  let destination = new URL('/', origin)
  if (requestedNext?.startsWith('/')) {
    try {
      const candidate = new URL(requestedNext, origin)
      if (candidate.origin === origin) destination = candidate
    } catch {
      // Malformed destinations fall back to the application's home page.
    }
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(destination)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
