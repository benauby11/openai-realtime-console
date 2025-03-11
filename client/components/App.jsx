import { useEffect, useRef, useState } from "react";
import logo from "/assets/TTLogo.png";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import axios from "axios";


export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [transcript, setTranscript] = useState(""); // Add state for transcript
  const [flagged, setFlag] = useState(false); // Add state for flagged content
  const peerConnection = useRef(null);
  const audioElement = useRef(null);

  async function startSession() {
    // Get an ephemeral key from the Fastify server
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-mini-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      message.event_id = message.event_id || crypto.randomUUID();
      dataChannel.send(JSON.stringify(message));
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }

  // Function to call the moderation API
  async function moderateContent(transcript) {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: transcript,
    }),
  });

  const result = await response.json();
  if (data.results && data.results.length > 0) {
    const flaggedCategories = Object.keys(data.results[0].categories).filter(
        (category) => data.results[0].categories[category]
    );

    console.log("Flagged Categories:", flaggedCategories);
    
    if (flaggedCategories.length > 0) {
        return flaggedCategories; // Return flagged categories (e.g., ["violence", "self-harm"])
    }
  }
  return result
}

// console.log("API Key:", import.meta.env.VITE_OPENAI_API_KEY ? "Loaded" : "Not Loaded");


  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", async (e) => {
        const event = JSON.parse(e.data);
        setEvents((prev) => [event, ...prev]);

        // Check for the transcript event type
        if (event.type === "conversation.item.input_audio_transcription.completed") {
          const transcript = event.transcript;
          setTranscript(transcript); // Set transcript

          // Call the moderation API  
          try {
            const moderationResult = await moderateContent(transcript);
            console.log(moderationResult.results);
            setFlag(moderationResult.results[0].flagged);
            if (moderationResult.results[0].flagged) {
              // Store true flagged categories in array
              const flaggedCategories = Object.keys(moderationResult.results[0].categories).filter(category => moderationResult.results[0].categories[category]);
              // So the message is sent in the console as well
              console.log(`Teddy Talk has detected the following flagged content: ${flaggedCategories.join(', ')}\nThis was the message said: ${transcript}\nReply STOP to stop receiving these messages.`);
              // This does not work yet
              axios.post('/send-sms', {
                phone: '12244302716',
                message: `Teddy Talk has detected the following flagged content: ${flaggedCategories.join(', ')}\nThis was the message said: ${transcript}`,
              }).then(response => {
                console.log(response.data);
              })
            }
          } catch (error) {
            console.error("Moderation error:", error);
          }
        }
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px", marginLeft: "10px" }} src={logo} />
          <h1>Teddy Talk Console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
            transcript={transcript}
            flagged={flagged}
          />
        </section>
      </main>
    </>
  );
}
