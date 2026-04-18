import { NextResponse } from 'next/server';
import {
  getEnclaveKeyPair,
  generateMockAttestation,
  isEnclaveMode,
} from '@/lib/enclave';
import { publicKeyToBase64 } from '@/lib/crypto';
import type { AttestationResponse } from '@/lib/types';

export async function GET(): Promise<NextResponse<AttestationResponse>> {
  if (!isEnclaveMode()) {
    return NextResponse.json({
      trusted: false,
      publicKey: null,
      attestation: null,
    });
  }

  const keyPair = getEnclaveKeyPair();

  return NextResponse.json({
    trusted: true,
    publicKey: publicKeyToBase64(keyPair.publicKey),
    attestation: generateMockAttestation(),
  });
}
