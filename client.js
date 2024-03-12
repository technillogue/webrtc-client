console.time("connecting");
console.time("loading");

let last_prompt = null;
let last_seed = null;
let last_sent = null;

async function getPrompt() {
  var prompt = document.getElementById("prompt");
  var seed = document.getElementById("seed");
  while (true) {
    console.log("checking if prompt");
    if (prompt && prompt.value) {
      if (prompt.value !== last_prompt /* || seed.value !== last_seed */) {
        last_prompt = prompt.value;
        last_seed = seed.value;
        console.log("got prompt");
        last_sent = Date.now();
        console.time("generation");
        return {
          prompt: prompt.value /*,seed: seed.value*/, system_prompt: "You are a helpful assistant"
        };
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

var last_token_time = 0;
var locationElem = document.getElementById("location");

function handleImage(data) {
  console.log("handling token");
  var parsed = JSON.parse(data);
  locationElem.hidden = false;
  var promptLatencyField = document.getElementById("prompt-latency");
  var promptLatency = Math.round(Date.now() - parsed.id);
  promptLatencyField.textContent = `prompt latency: ${promptLatency}ms`;
  var tokenLatencyField = document.getElementById("token-latency");
  if (parsed.idx == 1) {
    var firstTokenLatencyField = document.getElementById(
      "first-token-rt-latency",
    );
    firstTokenLatencyField.textContent = `first token rt latency: ${promptLatency}ms`;
    var firstTokenGenField = document.getElementById("first-token-gen-latency");
    firstTokenGenField.textContent = `first token server latency: ${parsed.token_gen_latency}ms`;
  }
  // last token, or start of request, to now
  var tokenLatency = Math.round(
    Date.now() - Math.max(last_token_time, parsed.id),
  );
  last_token_time = Date.now();
  tokenLatencyField.textContent = `last token latency: ${tokenLatency}ms`;
  var connectionField = document.getElementById("connections");
  connectionField.textContent = `total connections: ${parsed.batch_size}`;
  if (parsed.status == "done") {
    waiting = false;
    console.log("prediction done");
    sendPrompt();
  } else {
    document.getElementById(
      "gen-time",
    ).textContent = `token generation time: ${parsed.gen_time}ms`;
    document.getElementById("output").textContent += parsed.text;
  }
}

var sending = false;
var waiting = false;
function sendPrompt() {
  if (waiting || sending) {
    console.log("already waiting, not sending again");
    return;
  }
  sending = true;
  getPrompt().then((prompt) => {
    // let interval
    const trySend = () => {
      prompt.id = Date.now()
      data = JSON.stringify(prompt)
      if (dc !== null && dc_open) {
        document.getElementById("output").textContent = "";
        console.log("got prompt, actually sending over rtc");
        dataChannelLog.textContent += "> " + prompt + "\n";
        dc.send(data);
        // clearInterval(interval);
        sending = false;
        waiting = true;
      } else if (ws && ws.readyState === 1) {
        console.log("sending over ws");
        document.getElementById("output").textContent = "";
        ws.send(data);
        // clearInterval(interval);
        sending = false;
        waiting = true;
      } else {
        console.log("no connections open, retrying");
      }
    }
    trySend()
    // interval = setInterval(trySend, 1000);
  });
}

// webrtc stuff

// get DOM elements
var dataChannelLog = document.getElementById("data-channel"),
  iceConnectionLog = document.getElementById("ice-connection-state"),
  iceGatheringLog = document.getElementById("ice-gathering-state"),
  signalingLog = document.getElementById("signaling-state"),
  rtcPing = document.getElementById("rtc-ping");

// peer connection
var pc = null;

// data channel
var dc = null,
  dcInterval = null;
var dc_open = false;

let servers = []

function createPeerConnection() {
  var config = {
    sdpSemantics: "unified-plan",
  };

  if (document.getElementById("use-stun").checked) {
    // hm
    config.iceServers = [
      { urls: "stun:stun.relay.metered.ca:80" },
      // {
      //   urls: "turn:a.relay.metered.ca:80",
      //   username: "d0d9c8df0b9e209b5f81f70d",
      //   credential: "32ANR/GokUdBpWrp",
      // },
      // {
      //   urls: "turn:a.relay.metered.ca:443",
      //   username: "d0d9c8df0b9e209b5f81f70d",
      //   credential: "32ANR/GokUdBpWrp",
      // },
      {
        urls: "turn:a.relay.metered.ca:80?transport=tcp",
        username: "d0d9c8df0b9e209b5f81f70d",
        credential: "32ANR/GokUdBpWrp",
      },
      {
        urls: "turn:a.relay.metered.ca:443?transport=tcp",
        username: "d0d9c8df0b9e209b5f81f70d",
        credential: "32ANR/GokUdBpWrp",
      },
      // {
      //   urls: "turn:216.153.63.64:3478?transport=tcp",
      //   credential: "fakecred",
      //   username: "fakeuser",
      // },
      // { urls: "stun:216.153.63.64:3478" },
    ];
    /*SERVERS*/
    servers = config.iceServers
  }

  pc = new RTCPeerConnection(config);

  // register some listeners to help debugging
  pc.addEventListener(
    "icegatheringstatechange",
    () => {
      iceGatheringLog.textContent += " -> " + pc.iceGatheringState;
    },
    false,
  );
  iceGatheringLog.textContent = pc.iceGatheringState;

  pc.addEventListener(
    "iceconnectionstatechange",
    () => {
      iceConnectionLog.textContent += " -> " + pc.iceConnectionState;
    },
    false,
  );
  iceConnectionLog.textContent = pc.iceConnectionState;

  pc.addEventListener(
    "signalingstatechange",
    () => {
      signalingLog.textContent += " -> " + pc.signalingState;
    },
    false,
  );
  signalingLog.textContent = pc.signalingState;

  // connect audio / video
  // pc.addEventListener('track', function(evt) {
  //     if (evt.track.kind == 'video')
  //         document.getElementById('video').srcObject = evt.streams[0];
  //     else
  //         document.getElementById('audio').srcObject = evt.streams[0];
  // });
  // sdpFilterCodec

  return pc;
}

function negotiate() {
  return pc
    .createOffer()
    .then((offer) => {
      return pc.setLocalDescription(offer);
    })
    .then(() => {
      // wait for ICE gathering to complete
      return new Promise((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          function checkState() {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          }
          pc.addEventListener("icegatheringstatechange", checkState);
        }
      });
    })
    .then(() => {
      var offer = pc.localDescription;
      document.getElementById("offer-sdp").textContent = offer.sdp;
      // this part needs to go through runpod
      // proxy is fine-ish for this
      return fetch("/offer", {
        body: JSON.stringify({
          sdp: offer.sdp,
          type: offer.type,
          ice_servers: servers
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    })
    .then((response) => {
      return response.json();
    })
    .then((answer) => {
      document.getElementById("answer-sdp").textContent = answer.sdp;
      return pc.setRemoteDescription(answer);
    })
    .catch((e) => {
      console.log(e);
      alert(e);
    });
}

var time_start = null;

function current_stamp() {
  if (time_start === null) {
    time_start = new Date().getTime();
    return 0;
  } else {
    return new Date().getTime() - time_start;
  }
}

function start() {
  pc = createPeerConnection();

  // {"ordered": false, "maxRetransmits": 0}
  // {"ordered": false, "maxPacketLifetime": 500}
  dc = pc.createDataChannel("chat", { ordered: true });
  dc.onclose = () => {
    dc_open = false;
    clearInterval(dcInterval);
    dataChannelLog.textContent += "- close\n";
  };
  dc.onopen = () => {
    dc_open = true;
    console.log("onopen");
    dataChannelLog.textContent += "- open\n";
    dcInterval = setInterval(() => {
      var message = "ping " + current_stamp();
      dataChannelLog.textContent += "> " + message + "\n";
      dc.send(message);
    }, 1000);
    sendPrompt();
    console.log("started sending prompt");
    console.timeEnd("connecting");
  };
  dc.onmessage = (evt) => {
    dataChannelLog.textContent += "< " + evt.data + "\n";
    if (evt.data.substring(0, 4) === "pong") {
      var elapsed_ms = current_stamp() - parseInt(evt.data.substring(5), 10);
      dataChannelLog.textContent += " RTT " + elapsed_ms + " ms\n";
      rtcPing.textContent = `webRTC roundtrip ping: ${elapsed_ms}ms`;
    }
    if (evt.data.substring(0, 1) === "{") {
      handleImage(evt.data);
    }
  };

  negotiate();

  document.getElementById("stop").style.display = "inline-block";
}

function stop() {
  document.getElementById("stop").style.display = "none";

  // close data channel
  if (dc) {
    dc.close();
  }

  // close transceivers
  if (pc.getTransceivers) {
    pc.getTransceivers().forEach((transceiver) => {
      if (transceiver.stop) {
        transceiver.stop();
      }
    });
  }

  // close local audio / video
  pc.getSenders().forEach((sender) => {
    sender.track.stop();
  });

  // close peer connection
  setTimeout(() => {
    pc.close();
  }, 500);
}

let ws = new WebSocket(
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws",
);
var ws_open = false;
setInterval(() => {
  if (ws.readyState === 1) {
    var message = "ping " + current_stamp();
    ws.send(message);
  }
}, 1000);
ws.addEventListener("open", (event) => {
  ws_open = true;
  if (!dc_open) {
    sendPrompt();
  }
});
var wsPing = document.getElementById("ws-ping");

ws.addEventListener("message", ({ data }) => {
  if (data.substring(0, 4) === "pong") {
    var elapsed_ms = current_stamp() - parseInt(data.substring(5), 10);
    console.log("ws RTT " + elapsed_ms + " ms\n");
    wsPing.textContent = `websocket roundtrip ping: ${elapsed_ms}ms`;
  } else {
    handleImage(data);
  }
});
ws.addEventListener("close", (event) => {
  console.log("ws closed");
  ws_open = false;
});

//new Promise((r) => setTimeout(r, 10000)).then(() =>
start();
//);
console.timeEnd("loading");

//setInterval(function () {
//  if (!sending && !waiting) { sendPrompt() }
//}, 1000);
