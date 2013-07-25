var dbRef = new Firebase("https://webrtcdemo.firebaseIO.com/");
var roomRef = dbRef.child("rooms");

/**
room >
	124124 >
		candidate:A
		candidate:B
		offer
		answer
*/

function id () {
	return (Math.random() * 10000 + 10000 | 0).toString();
}

function send (room, key, data) {
	roomRef.child(room).child(key).set(data);
}

function recv (room, type, cb) {
	roomRef.child(room).child(type).on("value", function (snapshot, key) {
		var data = snapshot.val();
		if (data) { cb(data); }
	});
}

var ROOM = location.hash.substr(1);
var type = "answerer";
var otherType = "offerer";

if (!ROOM) {
	ROOM = id();
	type = "offerer";
	otherType = "answerer";
}

var ME = id();
console.log("Your ROOM", ROOM)
console.log("You are", type)

var server = {
	iceServers: [
		//{url: "stun:23.21.150.121"}
		{url: "stun:stun.l.google.com:19302"},
		//{url: "turn:turn:numb.viagenie.ca", credential: "webrtcdemo", username: "louis%40mozilla.com"}
	]
};

var options = {
	optional: [
		{DtlsSrtpKeyAgreement: true},
		{RtpDataChannels: true}
	]
}



var PeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var pc = new PeerConnection(server, options);

var SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
var IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;

var first = false;
pc.onicecandidate = function (e) {
	// take the first candidate that isn't null
	if (first || !e.candidate) { return; }
	first = true;

	recv(ROOM, "candidate:" + otherType, function (candidate) {
		console.log("GET CANDIDATE");
		pc.addIceCandidate(new IceCandidate(JSON.parse(candidate)));
	});

	send(ROOM, "candidate:"+type, JSON.stringify(e.candidate));
};

//datachannel or audio/video?
var channel = pc.createDataChannel("RTCDataChannel", {});

pc.ondatachannel = function (e) { 
	console.log("channel data on"); 
	var channel = e.channel;
	channel.onopen = function () { console.log("channel opened"); }
	channel.onerror = function (e) { console.log("channel error", e); }
	channel.onmessage = function (e) { console.log("channel message", e); }
	channel.onclose = function (e) { console.log("channel closed", e); }
}

var constraints = {
	mandatory: {
        OfferToReceiveAudio: true,
        OfferToReceiveVideo: true
    }
};

if (type === "offerer") {
	pc.createOffer(function (offer) {
		pc.setLocalDescription(offer);
		send(ROOM, "offer", JSON.stringify(offer));

		recv(ROOM, "answer", function (answer) {
			console.log("GOT ANSWER", answer.length);
			pc.setRemoteDescription(new SessionDescription(JSON.parse(answer)));
		});

		console.log("OFFER", offer)
	}, function (err) {
		console.error(err);
	}, constraints);

} else {
	recv(ROOM, "offer", function (offer) {
		console.log("GOT OFFER", offer.length);
		pc.setRemoteDescription(new SessionDescription(JSON.parse(offer)));

		pc.createAnswer(function (answer) {
			console.log("ANSWER", answer);
			pc.setLocalDescription(answer);

			send(ROOM, "answer", JSON.stringify(answer));
		}, function (err) {
			console.error(err);	
		}, constraints);	
	});	
}