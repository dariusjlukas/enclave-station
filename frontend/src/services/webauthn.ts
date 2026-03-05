import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export { browserSupportsWebAuthn };

export async function register(
  options: PublicKeyCredentialCreationOptionsJSON,
) {
  return startRegistration({ optionsJSON: options });
}

export async function authenticate(
  options: PublicKeyCredentialRequestOptionsJSON,
) {
  return startAuthentication({ optionsJSON: options });
}
