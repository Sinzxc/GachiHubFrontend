import { useState, useEffect, useRef } from "react";
import * as signalR from "@microsoft/signalr";

interface IUser {
  userName: string;
  connected?: boolean;
  connectionId: string;
}

interface ICall {
  callId: string;
  from: IUser;
  to: IUser;
}

function App() {
  const [connection, setConnection] = useState<signalR.HubConnection | null>(
    null
  );
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection>();
  const [isInVoice, setIsInVoice] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [users, setUsers] = useState<IUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<IUser | null>(null);
  const [volume, setVolume] = useState<number>(100); // Добавляем состояние для громкости
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentCallUser, setCurrentCallUser] = useState<string>();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [incomingCall, setIncomingCall] = useState<ICall>();
  // Заменяем состояние callId на useRef
  const callIdRef = useRef<string>();

  const [callId, setCallId] = useState<string>();

  // WebRTC variables
  // let peerConnection: RTCPeerConnection | null = null;

  // ICE servers for NAT traversal
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    // {
    //   urls: "turn:openrelay.metered.ca:80",
    //   username: "openrelayproject",
    //   credential: "openrelayproject",
    // },
  ];

  useEffect(() => {
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

    setConnection(hubConnection);

    // Create RTCPeerConnection
    setPeerConnection(new RTCPeerConnection({ iceServers }));

    connection?.invoke("GetAllUsers");
    return () => {
      hubConnection.stop();
    };
  }, []);

  // Функция для создания нового RTCPeerConnection
  const createNewPeerConnection = () => {
    // Закрываем предыдущее соединение, если оно существует
    if (peerConnection) {
      peerConnection.close();
    }

    // Создаем новое соединение
    const newPeerConnection = new RTCPeerConnection({ iceServers });
    setPeerConnection(newPeerConnection);
    return newPeerConnection;
  };

  const callUser = async (username: string) => {
    try {
      // Создаем новое соединение для каждого звонка
      const newPeerConnection = createNewPeerConnection();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);

      stream.getTracks().forEach((track) => {
        newPeerConnection.addTrack(track, stream);
      });

      connection?.invoke("CallUser", username);
      setCurrentCallUser(username);
    } catch (error) {
      console.error("Ошибка при вызове пользователя:", error);
    }
  };

  useEffect(() => {
    console.log("incomingCall: ", incomingCall);
  }, [incomingCall]);

  useEffect(() => {
    if (!connection || !peerConnection) return;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // Используем callIdRef.current вместо callId
        connection.invoke(
          "SendIceCandidate",
          event.candidate,
          callIdRef.current
        );
        console.log(username, callIdRef.current);
        // Не нужно сбрасывать incomingCall здесь
        // setIncomingCall(undefined);
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteAudio = document.getElementById(
        "remoteAudio"
      ) as HTMLAudioElement;
      if (remoteAudio && event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.volume = volume / 100; // Устанавливаем начальную громкость
      }
    };

    connection.on("CallingUser", (call: ICall) => {
      setIncomingCall(call);
      // Сохраняем callId в ref
      callIdRef.current = call.callId;
      console.log("Incoming call with ID:", call.callId);
    });

    connection.on("CreatedUser", (user: IUser) => {
      if (
        user.userName !== username &&
        !users.some((u) => u.userName === user.userName)
      ) {
        setUsers((prevUsers) => [...prevUsers, user]);
      }
    });

    // Добавляем обработчик ICE кандидатов
    connection.on(
      "ReceiveIceCandidate",
      async (response: { candidate: any; call: ICall }) => {
        try {
          await peerConnection.addIceCandidate(
            new RTCIceCandidate(response.candidate)
          );
        } catch (error) {
          console.error("Ошибка при добавлении ICE кандидата:", error);
        }
      }
    );

    connection?.on("UserDisconnected", (user: IUser) => {
      setUsers((prev) =>
        prev.filter((u) => u.connectionId != user.connectionId)
      );
    });

    connection.on("Users", (users: IUser[]) => {
      setUsers(users);
    });

    connection?.on(
      "ReceiveOffer",
      async (response: { offer: any; call: ICall }) => {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(response.offer)
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        connection.invoke("SendAnswer", answer, response.call.callId);
        setIsInVoice(true);
      }
    );

    connection?.on(
      "ReceiveAnswer",
      async (response: { answer: any; call: ICall }) => {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(response.answer)
        );
        setIsInVoice(true);
        // setCallId(response.call.callId);
      }
    );

    connection?.on("UserDisconnected", (user) => {
      setUsers(
        users.filter((u) => {
          if (user.userName !== u.userName) return u;
          return false;
        })
      );
    });

    connection.on("DeclinedCall", (call: ICall) => {
      setIncomingCall(undefined);
    });

    connection.on("AcceptedCall", async (call: ICall) => {
      setIsInVoice(true);
      try {
        // Создаем новое соединение при принятии звонка
        const newPeerConnection = createNewPeerConnection();

        setCurrentCallUser(call.to.userName);
        // Получаем доступ к микрофону при входящем звонке
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        setLocalStream(stream);

        // Добавляем треки в peer connection
        stream.getTracks().forEach((track) => {
          newPeerConnection.addTrack(track, stream);
        });

        const offer = await newPeerConnection.createOffer();
        await newPeerConnection.setLocalDescription(offer);
        connection.invoke("SendOffer", offer, call.callId);
        console.log(call);
        // Сохраняем callId в ref
        callIdRef.current = call.callId;
        console.log("AcceptedCall with ID:", call.callId);
      } catch (error) {
        console.error("Ошибка при получении звонка:", error);
      }
    });

    return () => {
      connection.off("CreatedUser");
      connection.off("ReceiveCall");
      connection.off("UserDisconnected");
      connection.off("Users");
      connection.off("ReceiveOffer");
      connection.off("ReceiveAnswer");
      connection.off("ReceiveIceCandidate");
      connection.off("UserDisconnected");
      connection.off("DeclinedCall");
      connection.off("AcceptedCall");
    };
  }, [connection, peerConnection]);

  // Добавляем эффект для обновления громкости при её изменении
  useEffect(() => {
    const remoteAudio = document.getElementById(
      "remoteAudio"
    ) as HTMLAudioElement;
    if (remoteAudio && remoteAudio.srcObject) {
      remoteAudio.volume = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        console.log("Состояние микрофона:", isMuted ? "выключен" : "включен");
        track.enabled = !isMuted;
      });
    }
  }, [localStream, isMuted]);

  async function stopStreaming() {
    try {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        setLocalStream(undefined);
      }

      // Закрываем текущее соединение
      if (peerConnection) {
        peerConnection.close();
        // Создаем новое соединение
        setPeerConnection(new RTCPeerConnection({ iceServers }));
      }

      setIsInVoice(false);
      setSelectedUser(null);
      connection?.invoke("GetAllUsers");
    } catch (error) {
      console.error("Error stopping voice:", error);
    }
  }

  const handleLogin = () => {
    console.log("created user: ", username);
    connection?.invoke("CreateUser", username.trim());
    setIsLoggedIn(true);
  };

  const selectUser = (user: IUser) => {
    setSelectedUser(user);
  };

  const declineCall = () => {
    connection?.invoke("DeclineCall", incomingCall?.callId);
  };
  const acceptCall = () => {
    if (incomingCall) {
      // Сохраняем callId в ref перед сбросом incomingCall
      callIdRef.current = incomingCall.callId;
      console.log("Accepting call with ID:", callIdRef.current);

      connection?.invoke("AcceptCall", incomingCall.callId);
      setCurrentCallUser(incomingCall.from.userName);
      setIsInVoice(true);
      setIncomingCall(undefined);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-lg p-6">
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
      {incomingCall && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold">Входящий звонок</h2>
              <p className="text-gray-400">
                от пользователя {incomingCall.from.userName}
              </p>
            </div>

            <div className="flex justify-center mb-4">
              <div className="w-24 h-24 rounded-full bg-white/50 p-[0.5]">
                <img
                  src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${incomingCall.from.userName}`}
                  alt="user avatar"
                />
              </div>
            </div>

            <div className="flex justify-between gap-4">
              <button
                onClick={() => {
                  declineCall();
                }}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
              >
                <div className="flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Отклонить
                </div>
              </button>

              <button
                onClick={() => {
                  acceptCall();
                }}
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors"
              >
                <div className="flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Принять
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="text-sm text-gray-400 mb-3">In call with:</div>
            <div className="flex items-center p-2 bg-gray-600 rounded mb-3">
              <div className="w-20 h-20 rounded-full bg-white/50 p-[0.5] mr-5">
                <img
                  src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${currentCallUser}`}
                  alt="user avatar"
                />
              </div>
              <div className="text-xl"> {currentCallUser}</div>
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

            {/* Добавляем кнопку выключения микрофона */}
            <div className="flex justify-center mb-3">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`px-4 py-2 rounded-md focus:outline-none focus:ring-2 transition-colors ${
                  isMuted
                    ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
                    : "bg-green-600 hover:bg-green-700 focus:ring-green-500"
                }`}
              >
                <div className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={
                        isMuted
                          ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z M5 5l14 14"
                          : "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      }
                    />
                  </svg>
                  {isMuted ? "Включить микрофон" : "Выключить микрофон"}
                </div>
              </button>
            </div>

            {/* Добавляем регулировку громкости */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-400">
                  Громкость: {volume}%
                </span>
                <div className="flex items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-gray-400 mr-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d={
                        volume === 0
                          ? "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                          : volume < 50
                          ? "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M15.536 8.464a5 5 0 010 7.072"
                          : "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17.07 9.93a8 8 0 010 4.14m-4.14-8.28a12 12 0 010 12.42"
                      }
                    />
                  </svg>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <div className="bg-gray-700 rounded-lg p-4 mb-6">
            <div className="text-sm text-gray-400 mb-3">Users</div>
            {users.map(
              (user) =>
                user != null &&
                user.userName !== username &&
                username !== undefined &&
                user.connected === true && (
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
                      <div className="w-20 h-20 rounded-full bg-white/50 p-[0.5] mr-5">
                        <img
                          src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${user.userName}`}
                          alt="user avatar"
                        />
                      </div>
                      <div className="text-xl">{user.userName}</div>
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
              onClick={() => selectedUser && callUser(selectedUser.userName)}
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
