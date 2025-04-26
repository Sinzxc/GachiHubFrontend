import { useState, useEffect, useCallback, useRef } from "react";
import * as signalR from "@microsoft/signalr";

interface IMessage {
  senderId: string;
  message: string;
}

interface IUser {
  userName: string;
  connected?: boolean;
  connectionId: string;
}

function App() {
  // const [connection, setConnection] = useState<signalR.HubConnection | null>(
  //   null
  // );
  // const [peerConnection, setPeerConnection] = useState<RTCPeerConnection>();
  const connection = useRef<signalR.HubConnection>(null);
  const peerConnection = useRef<RTCPeerConnection>(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const [isInVoice, setIsInVoice] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [users, setUsers] = useState<IUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<IUser | null>(null);

  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  useEffect(() => {
    const initialize = () => {
      const signalRServerUrl = import.meta.env.VITE_SIGNALR_SERVER;
      console.log("SignalR Server URL:", signalRServerUrl);
      const hubConnection = new signalR.HubConnectionBuilder()
        .withUrl(signalRServerUrl)
        .configureLogging(signalR.LogLevel.Debug)
        .withAutomaticReconnect()
        .build();

      hubConnection
        .start()
        .then(() => console.log("Connected to SignalR server"))
        .catch((err) => console.error("SignalR connection error:", err));

      connection.current = hubConnection;
    };

    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        setLocalStream(stream);
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = stream;
        }
        setupPeerConnection(stream);
      } catch (error) {
        console.error("Failed to get media devices:", error);
      }
    };
    initialize();
    initializeMedia();

    return () => {
      connection.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (connection != null) {
      connection?.current.invoke("GetAllUsers");
      connection?.current.on("Users", (users: IUser[]) => {
        console.log(users);
        setUsers(users);
      });
    }
  }, [isLoggedIn]);

   const setupPeerConnection = (stream) => {
      peerConnection.current = new RTCPeerConnection();
      stream.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, stream);
      });

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          .current.emit("sendCandidate", event.candidate);
        }
      };

      peerConnection.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };
    };

  if (connection.current != null) {

    const callUser = (username: string) => {
      connection?.current.invoke("CallUser", username);
    };

    connection?.current.on("ReceiveCall", async (user: IUser) => {
      console.log(user, "Receive");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      connection.invoke("SendOffer", offer);
    });

    connection?.current.on("UserDisconnected", (user) => {
      setUsers(
        users.filter((u) => {
          if (user.userName != u.userName) return user;
        })
      );
    });

    connection?.current.on("CreatedUser", (user: IUser) => {
      if (user.userName != username) {
        console.log("added users", user);
        setUsers([...users, user]);
      }
    });
  }
  const selectUser = (user: IUser) => {
    setSelectedUser(user);
  };

  const handleLogin = () => {
    console.log("created user: ", username);
    if (connection.current != null) {
      connection?.invoke("CreateUser", username.trim());
      setIsLoggedIn(true);
    }
  };
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-lg p-6">
          <audio ref={remoteAudioRef} autoPlay></audio>
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center mr-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold">Login</h1>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Enter your username"
            />
          </div>

          <button
            onClick={handleLogin}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center mr-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold">Voice Chat</h1>
          </div>
          <div className="text-sm text-gray-400">Logged in as: {username}</div>
        </div>

        {isInVoice ? (
          <div className="bg-gray-700 rounded-lg p-4 mb-6">
            <div className="text-sm text-gray-400 mb-3">
              In call with: {selectedUser?.userName}
            </div>
            <div className="flex items-center p-2 bg-gray-600 rounded">
              <div className="w-8 h-8 bg-indigo-600 rounded-full mr-2 relative">
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-700"></div>
              </div>
              <div>{selectedUser?.userName}</div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 ml-2 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
          </div>
        ) : (
          <div className="bg-gray-700 rounded-lg p-4 mb-6">
            <div className="text-sm text-gray-400 mb-3">Users</div>
            {users.map(
              (user) =>
                user.userName != username &&
                username != undefined &&
                user.connected == true && (
                  <div
                    key={user.connectionId}
                    className={`flex items-center justify-between p-2 ${
                      selectedUser?.connectionId === user.connectionId
                        ? "bg-gray-600"
                        : "hover:bg-gray-600"
                    } rounded mb-2 cursor-pointer`}
                    onClick={() => selectUser(user)}
                  >
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-indigo-600 rounded-full mr-2"></div>
                      <div>{user.userName}</div>
                    </div>
                    {selectedUser?.connectionId === user.connectionId && (
                      <div className="text-xs text-indigo-400">Selected</div>
                    )}
                  </div>
                )
            )}
          </div>
        )}

        <div className="flex justify-center">
          {!isInVoice ? (
            <button
              onClick={() => callUser(selectedUser!.userName!)}
              disabled={!selectedUser}
              className={`px-6 py-3 ${
                selectedUser
                  ? "bg-indigo-600 hover:bg-indigo-700"
                  : "bg-gray-600 cursor-not-allowed"
              } text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors`}
            >
              {selectedUser
                ? `Call ${selectedUser.userName}`
                : "Select a user to call"}
            </button>
          ) : (
            <button
              onClick={stopStreaming}
              className="px-6 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            >
              End Call
            </button>
          )}
        </div>
      </div>

      {/* Hidden audio element for remote audio */}
      <audio id="remoteAudio" autoPlay playsInline className="hidden"></audio>
    </div>
  );
}

export default App;
