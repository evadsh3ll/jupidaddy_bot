// commands/connect.js
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export function generateConnectLink(chatId, server_url, dappPublicKey) {
    const redirectLink = `${server_url}/phantom/callback?chat_id=${chatId}`;
    const params = new URLSearchParams({
        dapp_encryption_public_key: dappPublicKey,
        app_url: 'https://phantom.app',
        redirect_link: redirectLink,
        cluster: 'mainnet-beta',
    });

    return `https://phantom.app/ul/v1/connect?${params.toString()}`;
}

export function generatePaymentLink(chatId, server_url, dappPublicKey, phantomEncryptionPubKey, payload, dappKeyPair) {
    const { nonce, payload: encryptedPayload } = encryptPayload(payload, phantomEncryptionPubKey, dappKeyPair);
    const redirect = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${payload.requestId}`;
    
    const phantomParams = new URLSearchParams({
        dapp_encryption_public_key: dappPublicKey,
        nonce,
        redirect_link: encodeURIComponent(redirect),
        payload: encryptedPayload
    });

    return `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;
}

export function encryptPayload(jsonPayload, phantomEncryptionPubKey, dappKeyPair) {
    const nonce = nacl.randomBytes(24);
    const sharedSecret = nacl.box.before(
        bs58.decode(phantomEncryptionPubKey),
        dappKeyPair.secretKey
    );
    const encryptedPayload = nacl.box.after(
        Buffer.from(JSON.stringify(jsonPayload)),
        nonce,
        sharedSecret
    );
    return {
        nonce: bs58.encode(nonce),
        payload: bs58.encode(encryptedPayload)
    };
} 