import React, { useEffect, useRef } from "react";

function MicrophoneStream({
  connection,
}: {
  connection: signalR.HubConnection | null;
}) {
  return <div>Listening to microphone...</div>;
}

export default MicrophoneStream;
