import * as POSTPROCESSING from "postprocessing"
import { MotionBlurEffect, SSGIEffect, SSREffect, TRAAEffect } from "realism-effects"
import * as THREE from "three"
import {
	Box3,
	Clock,
	Color,
	EquirectangularReflectionMapping,
	Object3D,
	Vector3
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"

import { SharpnessEffect } from "/src/sharpness/SharpnessEffect"
import { VelocityDepthNormalPass } from "/src/temporal-reproject/pass/VelocityDepthNormalPass"
import "./style.css"
import { LensDistortionEffect } from "/src/lens-distortion/LensDistortionEffect"
import {  toHalfFloat } from "three/src/extras/DataUtils"

//VARIABLES
let traaEffect
let traaPass
let taaPass
let smaaPass
let fxaaPass
let ssgiEffect
const toRad = Math.PI / 180


// SCENE 
const scene = new THREE.Scene()
scene.matrixWorldAutoUpdate = false
window.scene = scene

//CAMERA
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 250)
window.camera = camera
scene.add(camera)

// RENDERER
const canvas = document.querySelector(".webgl")
const rendererCanvas = canvas
const renderer = new THREE.WebGLRenderer({
	canvas: rendererCanvas,
	powerPreference: "high-performance",
	premultipliedAlpha: false,
	stencil: false,
	antialias: false,
	alpha: false,
	preserveDrawingBuffer: true
})
renderer.autoClear = false
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;



//CONTROLS
const controls = new OrbitControls(camera, document.querySelector("#orbitControlsDomElem"))
controls.enableDamping = true
const cameraY = 8.75;
camera.position.fromArray([0, cameraY, 25])
controls.target.set(0, cameraY, 0)
controls.maxPolarAngle = Math.PI / 2
controls.minDistance = 5
window.controls = controls
window.camera = camera




//ENVIRONMENT
const rgbeLoader = new RGBELoader()
const initEnvMap = async (envMap) => {
    scene.environment?.dispose();
    envMap.mapping = EquirectangularReflectionMapping;
    scene.environment = envMap;
    scene.background = envMap;
	const darkColor = new Color(0x000)
	scene.background = darkColor
}

rgbeLoader.load("hdr/spree_bank_1k.hdr", initEnvMap);


//MODEL
const gltflLoader = new GLTFLoader()

const draco = new DRACOLoader()
draco.setDecoderConfig({ type: "js" })
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
gltflLoader.setPath("gltf/")
gltflLoader.setDRACOLoader(draco)

let url = "pot.glb"
let loadFiles = 9
		
gltflLoader.load(url, asset => {
	setupAsset(asset)
	initScene()
})


// LOADING SCREEN 
const loadingEl = document.querySelector("#loading")
const loadingText = document.querySelector("#loading-text")
const progressBar = document.querySelector("#progress-bar")
let loadedCount = 0

THREE.DefaultLoadingManager.onProgress = () => {
	loadedCount++
	const progress = Math.round((loadedCount / loadFiles) * 100)

	if (loadingEl && loadingText && progressBar) {
		loadingText.textContent = progress + "%"
		progressBar.style.width = progress + "%"
	}

	if (loadedCount >= loadFiles) {
		setTimeout(() => {
			if (loadingEl) loadingEl.remove()
		}, 150)
	}
}

//REALISM EFFECT POSTPROCESSING
const composer = new POSTPROCESSING.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
const initScene = async () => {
    // Define options for SSGI (Screen Space Global Illumination) Effect
    const options = {
        distance: 5.98,
        thickness: 2.83,
        denoiseIterations: 1,
        denoiseKernel: 3,
        denoiseDiffuse: 25,
        denoiseSpecular: 25.54,
        radius: 11,
        phi: 0.875,
        lumaPhi: 20.652,
        depthPhi: 23.37,
        normalPhi: 26.087,
        roughnessPhi: 18.478,
        specularPhi: 7.1,
        envBlur: 0,
        importanceSampling: true,
        steps: 20,
        refineSteps: 4,
        resolutionScale: 1,
        missedRays: false
    };

    // Initialize VelocityDepthNormalPass and add it to the composer
    const velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera);
    composer.addPass(velocityDepthNormalPass);
   

    // Initialize TRAA (Temporal Reprojection Anti-Aliasing) Effect
    traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass, {
        fullAccumulate: true
    });

    // Initialize Bloom Effect
    const bloomEffect = new POSTPROCESSING.BloomEffect({
        intensity: 1,
        mipmapBlur: true,
        luminanceSmoothing: 0.5,
        luminanceThreshold: 0.75,
        kernelSize: POSTPROCESSING.KernelSize.MEDIUM
    });

    // Initialize Vignette Effect
    const vignetteEffect = new POSTPROCESSING.VignetteEffect({
        darkness: 0.8,
        offset: 0.3
    });

    // Initialize SSGI Effect
    ssgiEffect = new SSGIEffect(composer, scene, camera, { ...options, velocityDepthNormalPass });
    window.ssgiEffect = ssgiEffect;

   

    // Load LUT (Look Up Table) texture and apply effects
    new POSTPROCESSING.LUT3dlLoader().load("lut_v2.3dl").then(lutTexture => {
        convertFloat32TextureToHalfFloat(lutTexture);
        const lutEffect = new POSTPROCESSING.LUT3DEffect(lutTexture);
        const toneMappingEffect = new POSTPROCESSING.ToneMappingEffect();
        toneMappingEffect.mode = POSTPROCESSING.ToneMappingMode.ACES_FILMIC;

   
        const sharpnessEffect = new SharpnessEffect({ sharpness: 0.75 });
        composer.addPass(new POSTPROCESSING.EffectPass(camera, ssgiEffect, toneMappingEffect));

        const lensDistortionEffect = new LensDistortionEffect({ aberration: 1 });

        traaPass = new POSTPROCESSING.EffectPass(camera, traaEffect);
        composer.addPass(traaPass);

        const motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass, { intensity: 1 });

        // composer.addPass(new POSTPROCESSING.EffectPass(camera,lensDistortionEffect,vignetteEffect,motionBlurEffect));
        composer.addPass(new POSTPROCESSING.EffectPass(camera, sharpnessEffect));
        composer.addPass(new POSTPROCESSING.EffectPass(camera, bloomEffect, lutEffect));
        

        const smaaEffect = new POSTPROCESSING.SMAAEffect();
        smaaPass = new POSTPROCESSING.EffectPass(camera, smaaEffect);

        const fxaaEffect = new POSTPROCESSING.FXAAEffect();
        fxaaPass = new POSTPROCESSING.EffectPass(camera, fxaaEffect);

	
		resize();
        loop();
    });
};



// LOOP Function 
const clock = new Clock()
const loop = () => {
	const dt = clock.getDelta()
	if (controls.enableDamping) controls.dampingFactor = 0.075 * 120 * Math.max(1 / 1000, dt)
	controls.update()
	camera.updateMatrixWorld()
	composer.render()
	window.requestAnimationFrame(loop)
}


//RESIZE FUNCTION 
const resize = () => {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()

	const dpr = window.devicePixelRatio
	renderer.setPixelRatio(Math.min(2, dpr))

	renderer.setSize(window.innerWidth, window.innerHeight)
	composer.setSize(window.innerWidth, window.innerHeight)
}

// event handlers
window.addEventListener("resize", resize)



const pointsObj = new Object3D()
scene.add(pointsObj)

const setupAsset = asset => {
	if (pointsObj.children.length > 0) {
		pointsObj.removeFromParent()
	}

	scene.add(asset.scene)


	const bb = new Box3()
	bb.setFromObject(asset.scene)

	const height = bb.max.y - bb.min.y
	const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
	const targetHeight = 15
	const targetWidth = 45

	const scaleWidth = targetWidth / width
	const scaleHeight = targetHeight / height

	asset.scene.scale.multiplyScalar(Math.min(scaleWidth, scaleHeight))

	asset.scene.updateMatrixWorld()

	bb.setFromObject(asset.scene)

	const center = new Vector3()
	bb.getCenter(center)

	center.y = bb.min.y
	asset.scene.position.sub(center)

	scene.updateMatrixWorld()
}

 // Function to convert Float32 texture to HalfFloat texture
 const convertFloat32TextureToHalfFloat = texture => {
	texture.type = THREE.HalfFloatType;

	const lutData = new Uint16Array(texture.image.data.length);
	const lutF32Data = texture.image.data;

	for (let i = 0; i < lutData.length; i++) {
		lutData[i] = toHalfFloat(lutF32Data[i]);
	}

	texture.image.data = lutData;
};