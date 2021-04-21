let color = '#FFF'
let strokeWidth = 4;
let socket;
let currentSketchIndex;
let p5Instances = [];

// Sending data to the socket
const sendMouse = (x, y, px, py, canvasIndex) => {
	const data = {
		x,
		y,
		px,
		py,
		color,
		strokeWidth,
		canvasIndex,
		socketID: socket.id,
	}

	socket.emit('mouse', data)
}

const instance = (sketch) => {
	
	let cv;
	sketch.setup = () => {
		// Creating canvas
		let cvPosX = 300, cvPosY = 100;
		const w = 200, h = 200;
		cv = sketch.createCanvas(w, h);
		// cv.position(cvPosX, cvPosY);
		cv.background(0);
		const sketchParent = cv.parent();

		// Callback function
		socket.on('mouse', (data) => {
			// if (canvasIndex && p5Instances[canvasIndex].parent() )
			const {color, x, y, px, py, strokeWidth, canvasIndex} = data;
			if (sketchParent.id && sketchParent.id.slice(-1) == canvasIndex) {
				sketch.stroke(color)
				sketch.strokeWeight(strokeWidth)
				sketch.line(x, y, px, py)
			}
		})

		socket.on('sketchIndex', ({sketchIndex}) => {
			currentSketchIndex = sketchIndex;
		})

		// Getting our buttons and the holder through the p5.js dom
		const colorPicker = sketch.select('#pickcolor')
		const colorButton = sketch.select('#color-btn')
		const colorDisplay = sketch.select('#color-holder')

		const strokeWidthPicker = sketch.select('#stroke-width-picker')
		const strokeButton = sketch.select('#stroke-btn')

		// Adding a mousePressed listener to the button
		colorButton.mousePressed(() => {
			// Checking if the input is a valid hex color
			if (/(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(colorPicker.value())) {
				color = colorPicker.value()
				colorDisplay.style('background-color', color)
			} else { 
				alert('Enter a valid hex value')
			}
		})

		// Adding a mousePressed listener to the button
		strokeButton.mousePressed(() => {
			const width = parseInt(strokeWidthPicker.value())
			if (width > 0) strokeWidth = width
		})
	}

	sketch.mouseDragged = () => {
		// Draw
		sketch.stroke(color)
		sketch.strokeWeight(strokeWidth)
		sketch.line(sketch.mouseX, sketch.mouseY, sketch.pmouseX, sketch.pmouseY)
		const index = cv.parent().id.slice(-1)
		sendMouse(sketch.mouseX, sketch.mouseY, sketch.pmouseX, sketch.pmouseY, index)
	}
}

socket = io.connect('https://shared-drawing.ngrok.io');
for (let i=0;i<4;i++) {
	const parentElementID = 'sketch-' + i;
	const p5Instance = new p5(instance, parentElementID);
	p5Instances.push(p5Instance);
}