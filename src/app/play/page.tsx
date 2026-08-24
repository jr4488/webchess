import { permanentRedirect } from 'next/navigation'

/** Hosted gameplay is retired; the packed OpenClaw install is the sole runtime. */
export default function PlayPage(): never {
  permanentRedirect('/install')
}
