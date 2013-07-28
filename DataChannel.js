!(function (window) {

// ICE Servers. You may want to include your own
var SERVER = {
	iceServers: [
		{url: "stun:23.21.150.121"},
		{url: "stun:stun.l.google.com:19302"},
		{url: "turn:numb.viagenie.ca", credential: "webrtcdemo", username: "louis%40mozilla.com"}
	]
};

// Peer Connection options
var OPTIONS = {
	optional: [
		{DtlsSrtpKeyAgreement: true},
		{RtpDataChannels: true}
	]
};

// Offer/Answer SDP constraints
var CONSTRAINTS = {
	mandatory: {
        OfferToReceiveAudio: true,
        OfferToReceiveVideo: true
    }
};

// shims for all the browser prefixes
var SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
var IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;
var PeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

function DataChannel (room, broker) {
	// room is a unique identifier between two parties to exchange
	// setup information
	this.room = room || DataChannel.id();

	// broker is an instance of an object which will exchange the data
	// default to FireBase
	this.broker = broker || new DataChannel.FireBase();
	this.broker.room = this.room;

	this.peerType = "offerer"; //either offerer or answerer
	
	// create the peer connection object
	this.pc = new PeerConnection(SERVER, OPTIONS);
	this.pc.onicecandidate = this._onIceCandidate.bind(this);

	window.addEventListener("unload", function () {
		this.broker.end(this.peerType);
	}.bind(this), true);
}

DataChannel.prototype = {
	_handlers: {},

	connect: function () {
		// before connecting, decide whether we are
		// the offerer or answerer with the broker
		this.broker.recvOnce("offer", function (data) {
			if (!data) { // no offer exists, so we'll be the offerer
				this.peerType = "offerer";
				this.otherType = "answerer";
			} else {
				this.peerType = "answerer";
				this.otherType = "offerer";
			}

			// call the real connect method
			console.log(this.peerType, this.otherType)
			this[this.peerType + "Connect"]();
		}.bind(this));
	},

	offererConnect: function () {
		// create the data channel
		this.channel = this.pc.createDataChannel(room, {});
		this._bindDataChannel();

		// generate an offer SDP and send it
		this.pc.createOffer(function (offer) {
			this.pc.setLocalDescription(offer);
			
			this.broker.send("offer", JSON.stringify(offer));

			// wait for an answer SDP
			this.broker.recv("answer", function (answer) {
				if (!answer) { return; }
				this.pc.setRemoteDescription(new SessionDescription(JSON.parse(answer)));
			}.bind(this));
		}.bind(this), function (err) {
			this.emit("error", err);
		}.bind(this), CONSTRAINTS);
	},

	answererConnect: function () {
		// answerer retrives channel from peer connection
		this.pc.ondatachannel = function (e) {
			this.channel = e.channel;
			this._bindDataChannel();
		}.bind(this);

		// wait for an offer
		this.broker.recv("offer", function (offer) {
			if (!offer) { return; }
			this.pc.setRemoteDescription(new SessionDescription(JSON.parse(offer)));

			// generate an answer SDP and send it
			this.pc.createAnswer(function (answer) {
				this.pc.setLocalDescription(answer);

				this.broker.send("answer", JSON.stringify(answer));
			}.bind(this), function (err) {
				this.emit("error", err)
			}.bind(this), CONSTRAINTS);
		}.bind(this));
	},

	on: function (evt, handler) {
		if (!this._handlers[evt]) { this._handlers[evt] = []; }
		this._handlers[evt].push(handler);
	},

	emit: function (evt, data) {
		var handlers = this._handlers[evt];
		if (!handlers || !handlers.length) { return; }

		for (var i = 0; i < handlers.length; ++i) {
			handlers[i].call(this, data);
		}
	},

	send: function (message) {
		this.channel.send(message);
	},

	close: function () {
		this.channel.close();
	},

	_onIceCandidate: function (e) {
		// take the first candidate, do nothing if empty candidate
		if (!e.candidate) { return; }
		this.pc.onicecandidate = null;

		// listen for the other peers ICE candidate
		this.broker.recv("candidate:" + this.otherType, function (candidate) {
			if (!candidate) { return; }
			this.pc.addIceCandidate(new IceCandidate(JSON.parse(candidate)));
		}.bind(this));

		// send our ICE candidate to other peer
		this.broker.send("candidate:" + this.peerType, JSON.stringify(e.candidate));
	},

	_bindDataChannel: function () {
		var channel = this.channel;
		channel.onopen = this.emit.bind(this, "open");
		channel.onerror = this.emit.bind(this, "error");
		channel.onmessage = this.emit.bind(this, "message");
		channel.onclose = this.emit.bind(this, "close");
	}
}

function s4 () {
	return Math.floor((1 + Math.random()) * 0x10000)
         .toString(16)
         .substring(1);
}

DataChannel.id = function () {
	return s4() + "-" + s4() + "-" + s4() + "-" + s4();
}

/**
* The Broker handles the required exchange information like
* offer/answer SDP and ICE candidates.
*
* You may write your own broker and host it yourself by
* implementing the following interface:
*
* send (String key, String data): 
*	Send a string with a unique key
* recv (String key, Function handler): 
*	Get data by unique key and execute handler (execute again if value changes)
* recvOnce (String key, Function Handler):
*	Get data by unique key and execute handler once (ignore value change).
* end (String peerType): 
*	Alert the server that the peer has ended communication.
*/
DataChannel.FireBase = function (url) {
	this.dbRef = new Firebase(url || "https://webrtcdemo.firebaseIO.com/");
	this.roomRef = this.dbRef.child("rooms");
};

DataChannel.FireBase.prototype = {
	send: function (key, data) {
		this.roomRef.child(this.room).child(key).set(data);
	},

	recv: function (key, handler) {
		this.roomRef.child(this.room).child(key).on("value", function (snapshot) {
			var data = snapshot.val();
			handler(data);
		});
	},

	recvOnce: function (key, handler) {
		this.roomRef.child(this.room).child(key).once("value", function (snapshot) {
			var data = snapshot.val();
			handler(data);
		});
	},

	end: function (type) {
		var key = type.substring(0, type.length - 2);
		this.recvOnce(key, function (data) {
			// if there was data, delete it
			if (data) {
				this.roomRef.child(this.room).child(key).remove();
			}
		});
	}
};

window.DataChannel = DataChannel;
})(window);