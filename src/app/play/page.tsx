import type { Metadata } from 'next'

import { App } from '@/App'
import { requirePageUser } from '@/server/auth'

export const metadata: Metadata = {
  title: 'Play',
}

export default async function PlayPage() {
  await requirePageUser('/play')

  return <App />
}
