// Cliente WHIP mínimo (WebRTC-HTTP Ingest Protocol, RFC 9725 en borrador).
// No implementa trickle-ICE: espera a que termine la recolección de
// candidatos antes de mandar el offer. Es menos "instantáneo" (añade
// ~0.5-1s al arranque) pero evita necesitar el endpoint PATCH y es
// compatible con MediaMTX sin complicar el cliente. Para IRL, ese medio
// segundo al empezar no importa.

export interface WhipSession {
  stop: () => Promise<void>;
  peerConnection: RTCPeerConnection;
}

export async function publishWhip(
  endpoint: string,
  stream: MediaStream,
  authHeader: string | undefined,
): Promise<WhipSession> {
  const pc = new RTCPeerConnection();
  stream.getTracks().forEach((track) => pc.addTransceiver(track, { direction: "sendonly" }));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: pc.localDescription!.sdp,
  });

  if (!res.ok) {
    pc.close();
    throw new Error(`WHIP POST falló: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const location = res.headers.get("Location");
  const resourceUrl = location ? new URL(location, endpoint).toString() : endpoint;
  const answerSdp = await res.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    peerConnection: pc,
    stop: async () => {
      try {
        await fetch(resourceUrl, {
          method: "DELETE",
          headers: authHeader ? { Authorization: authHeader } : {},
        });
      } catch {
        // si el DELETE falla (red caída, etc.) no bloqueamos el cierre local
      }
      pc.close();
    },
  };
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
    // salvaguarda: no esperar eternamente si algún candidato se cuelga
    setTimeout(resolve, 4000);
  });
}
