/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  ClimateState,
  OrganismState,
  ResourcePatch,
  SimulationSnapshot,
  TerrainMap,
  TerrainCell,
} from '../types/simulation.js';
import { getBiomeColor } from '../simulation/terrain/terrain.js';
import { CameraDirector } from './camera/director.js';

interface AmbientParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  type: 'spore' | 'leaf' | 'snowflake' | 'rain' | 'dust';
}

interface RiverSegment {
  x: number;
  y: number;
  flowAngle: number;
}

interface MountainPeak {
  x: number;
  y: number;
  radius: number;
}

interface DeathEffect {
  x: number;
  y: number;
  radius: number;
  color: number;
  startedAt: number;
}

export class GenesisRenderer {
  public app: Application;
  public camera: CameraDirector;
  public onOrganismSelect?: (organism: OrganismState | null) => void;

  private isInitialized = false;
  private containerElement: HTMLElement;
  private worldContainer: Container;
  private terrainSprite: Sprite | null = null;
  private waterAnimationGraphics: Graphics;
  private foliageAnimationGraphics: Graphics;
  private ambientDetailGraphics: Graphics;
  private disasterGraphics: Graphics;
  private resourceGraphics: Graphics;
  private organismGraphics: Graphics;
  private weatherGraphics: Graphics;
  private particleGraphics: Graphics;
  private atmosphereGraphics: Graphics;

  private currentSnapshot: SimulationSnapshot | null = null;
  private previousSnapshotMap: Map<string, { x: number; y: number; angle: number }> = new Map();
  private deathEffects: DeathEffect[] = [];
  private lastSnapshotTime = 0;
  private terrainMap: TerrainMap | null = null;
  private particles: AmbientParticle[] = [];
  private riverSegments: RiverSegment[] = [];
  private mountainPeaks: MountainPeak[] = [];
  private selectedOrganismId: string | null = null;
  private animFrameTime = 0;

  constructor(containerElement: HTMLElement) {
    this.containerElement = containerElement;
    this.app = new Application();
    this.worldContainer = new Container();
    this.waterAnimationGraphics = new Graphics();
    this.foliageAnimationGraphics = new Graphics();
    this.ambientDetailGraphics = new Graphics();
    this.disasterGraphics = new Graphics();
    this.resourceGraphics = new Graphics();
    this.organismGraphics = new Graphics();
    this.weatherGraphics = new Graphics();
    this.particleGraphics = new Graphics();
    this.atmosphereGraphics = new Graphics();
    this.camera = new CameraDirector(2560, 2560);
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    const width = this.containerElement.clientWidth || window.innerWidth;
    const height = this.containerElement.clientHeight || window.innerHeight;

    await this.app.init({
      width,
      height,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: 0x05080c,
      antialias: true,
    });

    this.containerElement.appendChild(this.app.canvas);

    // Layer hierarchy:
    // 1. Terrain Sprite (pre-baked painterly blended texture)
    // 2. Water Animation (shimmering waves & river foam)
    // 3. Foliage Animation (wind sway in canopies)
    // 4. Ambient Mountain Mist & Details
    // 5. Ecological Resources (flora blooms & carrion)
    // 6. Organisms (distinct genetic shapes, undulating limbs, vital auras)
    // 7. Subtle Weather Effects (rain ripples, rain streaks)
    // 8. Seasonal Spore & Leaf Particles
    // 9. Atmospheric Lighting (soft diurnal dawn/noon/dusk/night and seasonal color washes)
    this.worldContainer.addChild(this.waterAnimationGraphics);
    this.worldContainer.addChild(this.foliageAnimationGraphics);
    this.worldContainer.addChild(this.ambientDetailGraphics);
    this.worldContainer.addChild(this.disasterGraphics);
    this.worldContainer.addChild(this.resourceGraphics);
    this.worldContainer.addChild(this.organismGraphics);
    this.worldContainer.addChild(this.weatherGraphics);
    this.worldContainer.addChild(this.particleGraphics);
    this.worldContainer.addChild(this.atmosphereGraphics);
    this.app.stage.addChild(this.worldContainer);

    // Spawn ambient atmospheric particles
    for (let i = 0; i < 130; i++) {
      this.particles.push({
        x: Math.random() * 2560,
        y: Math.random() * 2560,
        vx: 0.15 + Math.random() * 0.45,
        vy: -0.15 + Math.random() * 0.3,
        size: 1.2 + Math.random() * 2.4,
        alpha: 0.2 + Math.random() * 0.45,
        type: 'spore',
      });
    }

    this.setupInteractions();
    this.isInitialized = true;

    // Start render ticker loop
    this.app.ticker.add((ticker) => {
      this.renderFrame(ticker.deltaTime / 60);
    });

    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = () => {
    if (!this.app.renderer) return;
    const width = this.containerElement.clientWidth || window.innerWidth;
    const height = this.containerElement.clientHeight || window.innerHeight;
    this.app.renderer.resize(width, height);
  };

  private setupInteractions(): void {
    const canvas = this.app.canvas;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      this.camera.setManualPan(dx, dy);
    });

    window.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;

      const dx = Math.abs(e.clientX - dragStartX);
      const dy = Math.abs(e.clientY - dragStartY);
      if (dx < 4 && dy < 4) {
        this.handleClick(e.clientX, e.clientY);
      }
    });

    // Touch support for mobile devices
    let touchStartX = 0;
    let touchStartY = 0;
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 1) {
          const dx = e.touches[0].clientX - touchStartX;
          const dy = e.touches[0].clientY - touchStartY;
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          this.camera.setManualPan(dx, dy);
        }
      },
      { passive: true }
    );

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.camera.setManualZoom(
          e.deltaY,
          e.clientX - rect.left,
          e.clientY - rect.top,
          rect.width,
          rect.height
        );
      },
      { passive: false }
    );
  }

  private handleClick(screenX: number, screenY: number): void {
    if (!this.currentSnapshot) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const cx = screenX - rect.left;
    const cy = screenY - rect.top;

    const worldX = (cx - this.app.screen.width / 2) / this.camera.current.zoom + this.camera.current.x;
    const worldY = (cy - this.app.screen.height / 2) / this.camera.current.zoom + this.camera.current.y;

    let clicked: OrganismState | null = null;
    let minDistSq = 28 * 28;

    for (let i = 0; i < this.currentSnapshot.organisms.length; i++) {
      const org = this.currentSnapshot.organisms[i];
      const dx = org.x - worldX;
      const dy = org.y - worldY;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        clicked = org;
      }
    }

    if (clicked) {
      this.selectedOrganismId = clicked.id;
      this.camera.focusOnOrganism(clicked);
    } else {
      this.selectedOrganismId = null;
    }

    if (this.onOrganismSelect) {
      this.onOrganismSelect(clicked);
    }
  }

  public setTerrain(terrain: TerrainMap): void {
    this.terrainMap = terrain;
    this.currentSnapshot = null;
    this.previousSnapshotMap.clear();
    this.deathEffects = [];
    this.buildTerrainTexture();
  }

  public updateSnapshot(snapshot: SimulationSnapshot): void {
    if (this.currentSnapshot) {
      const livingIds = new Set(snapshot.organisms.map((organism) => organism.id));
      const now = performance.now();
      for (const organism of this.currentSnapshot.organisms) {
        if (!livingIds.has(organism.id)) {
          this.deathEffects.push({
            x: organism.x,
            y: organism.y,
            radius: 6.2 * (organism.genome.bodySize || 1),
            color: parseInt(organism.speciesColorHex.replace('#', ''), 16) || 0x48c774,
            startedAt: now,
          });
        }
      }
      this.previousSnapshotMap.clear();
      for (let i = 0; i < this.currentSnapshot.organisms.length; i++) {
        const o = this.currentSnapshot.organisms[i];
        this.previousSnapshotMap.set(o.id, { x: o.x, y: o.y, angle: o.angle });
      }
    }
    this.currentSnapshot = snapshot;
    this.lastSnapshotTime = performance.now();
  }

  private buildTerrainTexture(): void {
    if (!this.terrainMap) return;
    const t = this.terrainMap;
    const w = t.width;
    const h = t.height;
    const cs = t.cellSize;

    const offscreen = document.createElement('canvas');
    offscreen.width = t.worldWidth;
    offscreen.height = t.worldHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(t.worldWidth, t.worldHeight);
    const data = imgData.data;

    this.riverSegments = [];
    this.mountainPeaks = [];

    const cellR = new Uint8ClampedArray(w * h);
    const cellG = new Uint8ClampedArray(w * h);
    const cellB = new Uint8ClampedArray(w * h);

    for (let i = 0; i < t.cells.length; i++) {
      const cell = t.cells[i];
      const colorNum = getBiomeColor(cell.biome);

      const r = (colorNum >> 16) & 0xff;
      const g = (colorNum >> 8) & 0xff;
      const b = colorNum & 0xff;

      cellR[i] = r;
      cellG[i] = g;
      cellB[i] = b;

      if (cell.isRiver && cell.flowDirection !== undefined) {
        this.riverSegments.push({
          x: cell.x * cs + cs * 0.5,
          y: cell.y * cs + cs * 0.5,
          flowAngle: cell.flowDirection,
        });
      }

      if (cell.biome === 'mountain' || cell.biome === 'snow_peak') {
        if (cell.height > 0.78 && Math.random() < 0.12) {
          this.mountainPeaks.push({
            x: cell.x * cs + cs * 0.5,
            y: cell.y * cs + cs * 0.5,
            radius: 18 + Math.random() * 22,
          });
        }
      }
    }

    // Paint cells with smooth 4-neighbor transition blending
    for (let py = 0; py < t.worldHeight; py++) {
      const gy = Math.min(h - 1, Math.floor(py / cs));
      const fy = (py % cs) / cs;

      for (let px = 0; px < t.worldWidth; px++) {
        const gx = Math.min(w - 1, Math.floor(px / cs));
        const fx = (px % cs) / cs;

        const idx = gy * w + gx;
        const r00 = cellR[idx];
        const g00 = cellG[idx];
        const b00 = cellB[idx];

        const idxRight = gy * w + Math.min(w - 1, gx + 1);
        const idxDown = Math.min(h - 1, gy + 1) * w + gx;
        const idxDiag = Math.min(h - 1, gy + 1) * w + Math.min(w - 1, gx + 1);

        const rTop = r00 * (1 - fx) + cellR[idxRight] * fx;
        const gTop = g00 * (1 - fx) + cellG[idxRight] * fx;
        const bTop = b00 * (1 - fx) + cellB[idxRight] * fx;

        const rBot = cellR[idxDown] * (1 - fx) + cellR[idxDiag] * fx;
        const gBot = cellG[idxDown] * (1 - fx) + cellG[idxDiag] * fx;
        const bBot = cellB[idxDown] * (1 - fx) + cellB[idxDiag] * fx;

        const finalR = rTop * (1 - fy) + rBot * fy;
        const finalG = gTop * (1 - fy) + gBot * fy;
        const finalB = bTop * (1 - fy) + bBot * fy;

        const pIdx = (py * t.worldWidth + px) * 4;
        data[pIdx] = finalR;
        data[pIdx + 1] = finalG;
        data[pIdx + 2] = finalB;
        data[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Accentuate rivers with painterly strokes
    ctx.lineWidth = 3.8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#227b8f';
    ctx.beginPath();
    for (let i = 0; i < this.riverSegments.length; i++) {
      const r = this.riverSegments[i];
      const dx = Math.cos(r.flowAngle) * cs * 0.7;
      const dy = Math.sin(r.flowAngle) * cs * 0.7;
      ctx.moveTo(r.x - dx, r.y - dy);
      ctx.lineTo(r.x + dx, r.y + dy);
    }
    ctx.stroke();

    const texture = Texture.from(offscreen);
    if (this.terrainSprite) {
      this.worldContainer.removeChild(this.terrainSprite);
      this.terrainSprite.destroy(true);
    }

    this.terrainSprite = new Sprite(texture);
    this.worldContainer.addChildAt(this.terrainSprite, 0);
  }

  private renderFrame(dtSeconds: number): void {
    if (!this.isInitialized || !this.currentSnapshot || !this.terrainMap) return;
    this.animFrameTime += dtSeconds;

    // Update camera director with comprehensive Event Scoring Algorithm
    this.camera.update(dtSeconds, this.currentSnapshot, this.terrainMap);

    // Smoothly position world container
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const zoom = this.camera.current.zoom;

    this.worldContainer.position.set(
      screenW / 2 - this.camera.current.x * zoom,
      screenH / 2 - this.camera.current.y * zoom
    );
    this.worldContainer.scale.set(zoom);

    // Render layers
    this.renderWaterAnimation();
    this.renderFoliageMovement();
    this.renderAmbientDetails();
    this.renderDisasters();
    this.renderResources();
    this.renderOrganisms();
    this.renderSubtleWeather(this.currentSnapshot.climate);
    this.renderSeasonalParticles(this.currentSnapshot.climate);
    this.renderAtmosphericLighting(this.currentSnapshot.climate);
  }

  private renderWaterAnimation(): void {
    const g = this.waterAnimationGraphics;
    g.clear();

    const time = this.animFrameTime;

    // Flowing river foam
    for (let i = 0; i < this.riverSegments.length; i += 3) {
      const seg = this.riverSegments[i];
      const phase = (time * 2.8 + i * 0.4) % 1.0;
      const dist = (phase - 0.5) * 12;
      const px = seg.x + Math.cos(seg.flowAngle) * dist;
      const py = seg.y + Math.sin(seg.flowAngle) * dist;
      const alpha = Math.sin(phase * Math.PI) * 0.65;

      g.circle(px, py, 1.2).fill({ color: 0xdaf1f7, alpha });
    }

    // Open-water wave ripples
    const rippleCount = 14;
    for (let i = 0; i < rippleCount; i++) {
      const rx = 400 + ((i * 180 + time * 20) % 1760);
      const ry = 300 + (Math.sin(time * 0.4 + i) * 60 + i * 140);
      const wavePhase = Math.sin(time * 1.8 + i);
      const rAlpha = (wavePhase * 0.5 + 0.5) * 0.22;

      g.ellipse(rx, ry, 16 + wavePhase * 4, 3.5).stroke({
        color: 0x48a8c4,
        width: 1.0,
        alpha: rAlpha,
      });
    }
  }

  private renderFoliageMovement(): void {
    if (!this.terrainMap) return;
    const g = this.foliageAnimationGraphics;
    g.clear();

    const time = this.animFrameTime;
    const t = this.terrainMap;
    const cs = t.cellSize;

    const camX = this.camera.current.x;
    const camY = this.camera.current.y;
    const viewRadius = 800 / this.camera.current.zoom;

    const minGx = Math.max(0, Math.floor((camX - viewRadius) / (cs * 8)));
    const maxGx = Math.min(Math.floor(t.width / 8) - 1, Math.ceil((camX + viewRadius) / (cs * 8)));
    const minGy = Math.max(0, Math.floor((camY - viewRadius) / (cs * 8)));
    const maxGy = Math.min(Math.floor(t.height / 8) - 1, Math.ceil((camY + viewRadius) / (cs * 8)));

    for (let sGy = minGy; sGy <= maxGy; sGy++) {
      for (let sGx = minGx; sGx <= maxGx; sGx++) {
        const gx = sGx * 8 + 4;
        const gy = sGy * 8 + 4;
        const cell = t.cells[gy * t.width + gx];
        if (!cell || (cell.biome !== 'forest' && cell.biome !== 'ancient_forest')) continue;

        const cx = gx * cs;
        const cy = gy * cs;
        const windOffset = Math.sin(time * 2.2 + cx * 0.05 + cy * 0.03) * 2.5;

        g.circle(cx + windOffset, cy, 7.5).fill({ color: 0x367a42, alpha: 0.35 });
        g.circle(cx + windOffset * 0.6, cy - 2, 4.5).fill({ color: 0x4fa85c, alpha: 0.45 });
      }
    }
  }

  private renderAmbientDetails(): void {
    const g = this.ambientDetailGraphics;
    g.clear();

    const time = this.animFrameTime;

    for (let i = 0; i < this.mountainPeaks.length; i++) {
      const peak = this.mountainPeaks[i];
      const mistDrift = (time * 8 + i * 35) % 120;
      const mx = peak.x + mistDrift - 60;
      const my = peak.y + Math.sin(time * 0.8 + i) * 6;
      const alpha = Math.sin((mistDrift / 120) * Math.PI) * 0.32;

      g.ellipse(mx, my, peak.radius * 1.4, peak.radius * 0.6).fill({
        color: 0xf0f6fa,
        alpha,
      });
    }
  }

  private renderDisasters(): void {
    if (!this.currentSnapshot) return;
    const g = this.disasterGraphics;
    g.clear();

    const disasters = this.currentSnapshot.climate.activeDisasters;
    if (!disasters || disasters.length === 0) return;

    const time = this.animFrameTime;

    for (let i = 0; i < disasters.length; i++) {
      const d = disasters[i];
      if (!d.active) continue;

      if (d.type === 'wildfire') {
        const pulse = Math.sin(time * 5.5 + i) * 8;
        const outerR = d.radius + pulse;

        g.circle(d.x, d.y, outerR * 1.05).fill({ color: 0x1c1917, alpha: 0.35 * d.severity });
        g.circle(d.x, d.y, outerR * 0.85).fill({ color: 0xea580c, alpha: 0.45 * d.severity });
        g.circle(d.x, d.y, outerR * 0.55).fill({ color: 0xfacc15, alpha: 0.55 * d.severity });
        g.circle(d.x, d.y, outerR).stroke({ color: 0xf97316, width: 2.5, alpha: 0.85 });

        for (let sp = 0; sp < 6; sp++) {
          const spAngle = time * 2.5 + (sp * Math.PI) / 3;
          const spDist = (d.radius * 0.7) * (0.35 + (sp % 3) * 0.3);
          const spX = d.x + Math.cos(spAngle) * spDist;
          const spY = d.y + Math.sin(spAngle) * spDist;
          g.circle(spX, spY, 2.5).fill({ color: 0xffedd5, alpha: 0.9 });
        }
      } else if (d.type === 'flood') {
        const wave = Math.sin(time * 3 + i) * 6;
        g.circle(d.x, d.y, d.radius + wave).fill({ color: 0x0284c7, alpha: 0.38 * d.severity });
        g.circle(d.x, d.y, d.radius * 0.75).fill({ color: 0x38bdf8, alpha: 0.22 * d.severity });
        g.circle(d.x, d.y, d.radius * 0.95 + wave).stroke({ color: 0xbae6fd, width: 1.8, alpha: 0.6 });
      } else if (d.type === 'volcanic_eruption') {
        const pulse = Math.sin(time * 3.5) * 12;
        g.circle(d.x, d.y, d.radius + pulse).fill({ color: 0x27272a, alpha: 0.55 * d.severity });
        g.circle(d.x, d.y, d.radius * 0.65).fill({ color: 0x3f3f46, alpha: 0.65 * d.severity });
        const calderaR = d.radius * 0.28;
        g.circle(d.x, d.y, calderaR + Math.sin(time * 7) * 4).fill({ color: 0xdc2626, alpha: 0.85 });
        g.circle(d.x, d.y, calderaR * 0.55).fill({ color: 0xfef08a, alpha: 0.95 });
        g.circle(d.x, d.y, calderaR).stroke({ color: 0xf97316, width: 3.0, alpha: 0.9 });
      } else if (d.type === 'cold_snap') {
        const pulse = Math.sin(time * 2 + i) * 10;
        g.circle(d.x, d.y, d.radius + pulse).fill({ color: 0x93c5fd, alpha: 0.25 * d.severity });
        g.circle(d.x, d.y, d.radius * 0.7).stroke({ color: 0xe0f2fe, width: 1.5, alpha: 0.45 });
      }
    }
  }

  private renderResources(): void {
    if (!this.currentSnapshot) return;
    const g = this.resourceGraphics;
    g.clear();

    const resources = this.currentSnapshot.resources;
    const time = this.animFrameTime;

    for (let i = 0; i < resources.length; i++) {
      const res = resources[i];
      if (res.type === 'plant') {
        const norm = Math.max(0.1, res.amount / res.maxAmount);
        const radius = res.radius * (0.6 + norm * 0.4);
        const pulse = Math.sin(time * 1.5 + i) * 0.8;

        g.circle(res.x, res.y, radius + pulse).fill({ color: 0x4a853d, alpha: 0.35 * norm });
        g.circle(res.x, res.y, radius * 0.65).fill({ color: 0x76b852, alpha: 0.8 * norm });
        if (norm > 0.6) {
          g.circle(res.x + 2, res.y - 2, 2.5).fill({ color: 0xefd36f, alpha: 0.85 });
        }
      } else if (res.type === 'carrion') {
        const decayAlpha = Math.min(1.0, Math.max(0.25, res.amount / res.maxAmount));
        g.circle(res.x, res.y, res.radius * 1.1).fill({ color: 0x3d3027, alpha: 0.5 * decayAlpha });
        g.circle(res.x, res.y, res.radius * 0.75).fill({ color: 0x7c6453, alpha: 0.7 * decayAlpha });
        g.moveTo(res.x - res.radius * 0.45, res.y - res.radius * 0.15)
          .lineTo(res.x + res.radius * 0.45, res.y + res.radius * 0.15)
          .stroke({ color: 0xe8decb, width: 2.2, alpha: 0.85 * decayAlpha });
      } else if (res.type === 'water_spring') {
        const poolAlpha = Math.min(1.0, Math.max(0.2, res.amount / res.maxAmount));
        const pulse = Math.sin(time * 2.2 + i) * 1.2;
        g.circle(res.x, res.y, res.radius + pulse).fill({ color: 0x0284c7, alpha: 0.45 * poolAlpha });
        g.circle(res.x, res.y, res.radius * 0.65).fill({ color: 0x38bdf8, alpha: 0.7 * poolAlpha });
        g.circle(res.x, res.y, res.radius).stroke({ color: 0xbae6fd, width: 1.5, alpha: 0.75 * poolAlpha });
      }
    }
  }

  /**
   * Renders organisms with shapes strictly determined by genetics,
   * smooth walking, hunting, fleeing, feeding, birth, and death animations.
   */
  private renderOrganisms(): void {
    if (!this.currentSnapshot) return;
    const g = this.organismGraphics;
    g.clear();

    const organisms = this.currentSnapshot.organisms;
    const time = this.animFrameTime;

    const now = performance.now();
    const elapsedSinceSnapshot = Math.max(0, now - this.lastSnapshotTime);
    const alpha = Math.min(1.25, elapsedSinceSnapshot / 50.0);

    for (let i = 0; i < organisms.length; i++) {
      const org = organisms[i];
      if (org.state === 'dead') continue;

      let posX = org.x;
      let posY = org.y;
      let angle = org.angle;

      const prev = this.previousSnapshotMap.get(org.id);
      if (prev) {
        posX = prev.x + (org.x - prev.x) * alpha;
        posY = prev.y + (org.y - prev.y) * alpha;

        let angleDiff = org.angle - prev.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        angle = prev.angle + angleDiff * alpha;
      }

      const size = 6.2 * (org.genome.bodySize || 1.0);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const speed = Math.hypot(org.vx, org.vy);
      const colorNum = parseInt(org.speciesColorHex.replace('#', ''), 16) || 0x48c774;
      const diet = org.genome.diet;

      // 1. Birth Animation: Expanding translucent birth ripple for young organisms
      if (org.age < 35) {
        const birthProgress = org.age / 35;
        const birthRadius = size * (1.2 + birthProgress * 2.2);
        const birthAlpha = (1.0 - birthProgress) * 0.75;
        g.circle(posX, posY, birthRadius).stroke({ color: 0xffffff, width: 1.5, alpha: birthAlpha });
        g.circle(posX, posY, birthRadius * 0.6).fill({ color: 0xa7f3d0, alpha: birthAlpha * 0.4 });
      }

      // 2. Selection indicator radar
      if (org.id === this.selectedOrganismId) {
        g.circle(posX, posY, org.genome.visionRange).stroke({ color: 0xffffff, width: 0.8, alpha: 0.22 });
        g.circle(posX, posY, size * 2.8).stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
      }

      // 3. Thermal Adaptations
      if (org.genome.coldTolerance <= 0) {
        const frostAlpha = Math.min(0.65, Math.abs(org.genome.coldTolerance) / 22);
        g.circle(posX, posY, size * 1.45).stroke({ color: 0xbae6fd, width: 1.2, alpha: frostAlpha });
      } else if (org.genome.heatTolerance >= 34) {
        const heatAlpha = Math.min(0.65, (org.genome.heatTolerance - 30) / 16);
        g.circle(posX, posY, size * 1.45).stroke({ color: 0xf59e0b, width: 1.2, alpha: heatAlpha });
      }

      // 4. Undulating Tail & Walking/Swimming Gait (Scales with genetics)
      const tailWaveFreq = 6 + (org.genome.speed || 2.0) * 3.4;
      const tailOscillation = Math.sin(time * tailWaveFreq * Math.max(0.6, speed) + i);
      const tailWave = tailOscillation * (size * 0.48);
      const tailLength = size * (1.1 + (org.genome.tailLength || 1.0) * 0.48);

      // Multi-segment tail
      const tailMidX = posX - cosA * (tailLength * 0.5) - sinA * (tailWave * 0.5);
      const tailMidY = posY - sinA * (tailLength * 0.5) + cosA * (tailWave * 0.5);
      const tailEndX = posX - cosA * tailLength - sinA * tailWave;
      const tailEndY = posY - sinA * tailLength + cosA * tailWave;

      g.moveTo(posX - cosA * (size * 0.4), posY - sinA * (size * 0.4))
        .lineTo(tailMidX, tailMidY)
        .lineTo(tailEndX, tailEndY)
        .stroke({ color: colorNum, width: Math.max(1.8, size * 0.38), alpha: 0.8 });

      // Rhythmic side limbs / fin paddles oscillating with walking cycle
      const legOffset = Math.sin(time * tailWaveFreq * 0.8 + i) * (size * 0.3);
      const limbSide = size * 0.9;
      g.moveTo(posX - cosA * (size * 0.1) - sinA * limbSide, posY - sinA * (size * 0.1) + cosA * limbSide + legOffset)
        .lineTo(posX + cosA * (size * 0.3) - sinA * (limbSide * 1.25), posY + sinA * (size * 0.3) + cosA * (limbSide * 1.25))
        .stroke({ color: colorNum, width: 1.4, alpha: 0.7 });

      g.moveTo(posX - cosA * (size * 0.1) + sinA * limbSide, posY - sinA * (size * 0.1) - cosA * limbSide - legOffset)
        .lineTo(posX + cosA * (size * 0.3) + sinA * (limbSide * 1.25), posY + sinA * (size * 0.3) - cosA * (limbSide * 1.25))
        .stroke({ color: colorNum, width: 1.4, alpha: 0.7 });

      // 5. Distinct Creature Body Shapes determined by Genetics & Diet
      const bodyAlpha = Math.max(0.52, 0.98 - (org.genome.camouflage || 0) * 0.46);

      if (diet === 'carnivore') {
        // Predator: Streamlined angular wedge / raptor silhouette
        const headX = posX + cosA * (size * 1.4);
        const headY = posY + sinA * (size * 1.4);
        const flankLeftX = posX - cosA * (size * 0.8) - sinA * (size * 0.85);
        const flankLeftY = posY - sinA * (size * 0.8) + cosA * (size * 0.85);
        const flankRightX = posX - cosA * (size * 0.8) + sinA * (size * 0.85);
        const flankRightY = posY - sinA * (size * 0.8) - cosA * (size * 0.85);

        g.moveTo(headX, headY)
          .lineTo(flankLeftX, flankLeftY)
          .lineTo(posX - cosA * (size * 0.5), posY - sinA * (size * 0.5))
          .lineTo(flankRightX, flankRightY)
          .closePath()
          .fill({ color: colorNum, alpha: bodyAlpha });

        // Predatory horn / cranial crest proportional to aggression
        const aggression = org.genome.aggression || 0.4;
        const hornLength = size * (0.35 + aggression * 0.8);
        const hornTipX = posX + cosA * (size * 1.4 + hornLength);
        const hornTipY = posY + sinA * (size * 1.4 + hornLength);
        g.moveTo(headX - sinA * (size * 0.25), headY + cosA * (size * 0.25))
          .lineTo(hornTipX, hornTipY)
          .lineTo(headX + sinA * (size * 0.25), headY - cosA * (size * 0.25))
          .fill({ color: 0x0f172a, alpha: 0.9 });
      } else if (diet === 'herbivore') {
        // Herbivore: Gentle rounded barrel body with soft grazing contour
        g.ellipse(posX, posY, size * 1.35, size * 1.05).fill({ color: colorNum, alpha: bodyAlpha });
        // Soft rounded muzzle
        const muzzleX = posX + cosA * (size * 1.15);
        const muzzleY = posY + sinA * (size * 1.15);
        g.circle(muzzleX, muzzleY, size * 0.55).fill({ color: colorNum, alpha: bodyAlpha });
      } else if (diet === 'scavenger') {
        // Scavenger: Flexible low-profile elongated torso with sensory whiskers
        g.ellipse(posX, posY, size * 1.45, size * 0.75).fill({ color: colorNum, alpha: bodyAlpha });
        // Olfactory whiskers probing ahead
        const wEnd1X = posX + cosA * (size * 1.6) - sinA * (size * 0.6);
        const wEnd1Y = posY + sinA * (size * 1.6) + cosA * (size * 0.6);
        const wEnd2X = posX + cosA * (size * 1.6) + sinA * (size * 0.6);
        const wEnd2Y = posY + sinA * (size * 1.6) - cosA * (size * 0.6);
        g.moveTo(posX + cosA * size, posY + sinA * size).lineTo(wEnd1X, wEnd1Y).stroke({ color: colorNum, width: 1.2, alpha: 0.75 });
        g.moveTo(posX + cosA * size, posY + sinA * size).lineTo(wEnd2X, wEnd2Y).stroke({ color: colorNum, width: 1.2, alpha: 0.75 });
      } else {
        // Omnivore: Agile streamlined oval with dual dorsal spines
        g.ellipse(posX, posY, size * 1.3, size * 0.95).fill({ color: colorNum, alpha: bodyAlpha });
        g.circle(posX - cosA * (size * 0.3) - sinA * (size * 0.4), posY - sinA * (size * 0.3) + cosA * (size * 0.4), size * 0.25).fill({ color: 0x1e293b, alpha: 0.6 });
        g.circle(posX - cosA * (size * 0.3) + sinA * (size * 0.4), posY - sinA * (size * 0.3) - cosA * (size * 0.4), size * 0.25).fill({ color: 0x1e293b, alpha: 0.6 });
      }

      // 6. Eyes (scale directly with vision range)
      const eyeScale = Math.max(0.75, Math.min(1.4, (org.genome.visionRange || 110) / 110));
      const eyeOffset = size * 0.6;
      const eyeSide = size * 0.48;
      const eye1X = posX + cosA * eyeOffset - sinA * eyeSide;
      const eye1Y = posY + sinA * eyeOffset + cosA * eyeSide;
      const eye2X = posX + cosA * eyeOffset + sinA * eyeSide;
      const eye2Y = posY + sinA * eyeOffset - cosA * eyeSide;

      g.circle(eye1X, eye1Y, Math.max(1.1, size * 0.22 * eyeScale)).fill({ color: 0x0f172a, alpha: 0.95 });
      g.circle(eye2X, eye2Y, Math.max(1.1, size * 0.22 * eyeScale)).fill({ color: 0x0f172a, alpha: 0.95 });
      g.circle(eye1X + cosA * 0.8, eye1Y + sinA * 0.8, Math.max(0.6, size * 0.08 * eyeScale)).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(eye2X + cosA * 0.8, eye2Y + sinA * 0.8, Math.max(0.6, size * 0.08 * eyeScale)).fill({ color: 0xffffff, alpha: 0.9 });

      // 7. Action Animations (Hunting, Fleeing, Feeding, Resting)
      if (org.state === 'hunting') {
        // Sleek forward attack lunge aura
        g.circle(posX + cosA * (size * 0.5), posY + sinA * (size * 0.5), size * 1.95).stroke({
          color: 0xf87171,
          width: 1.4,
          alpha: 0.75,
        });
      } else if (org.state === 'fleeing') {
        // Evasive wake ripples
        g.circle(posX, posY, size * 1.9).stroke({ color: 0x38bdf8, width: 1.4, alpha: 0.75 });
        g.circle(posX - cosA * (size * 0.8), posY - sinA * (size * 0.8), size * 1.2).stroke({
          color: 0xe0f2fe,
          width: 0.8,
          alpha: 0.45,
        });
      } else if (org.state === 'eating' || org.state === 'scavenging') {
        // Rhythmic feeding pulse
        const feedPulse = Math.sin(time * 8.0) * (size * 0.25);
        g.circle(posX + cosA * size, posY + sinA * size, size * 0.85 + feedPulse).fill({
          color: 0x4ade80,
          alpha: 0.5,
        });
      } else if (org.state === 'reproducing' || org.state === 'mating') {
        g.circle(posX, posY, size * 2.1).stroke({ color: 0xf472b6, width: 1.3, alpha: 0.8 });
      } else if (org.state === 'drinking') {
        const drinkPulse = Math.sin(time * 6.5) * (size * 0.22);
        g.circle(posX + cosA * (size * 0.7), posY + sinA * (size * 0.7), size * 0.95 + drinkPulse).stroke({
          color: 0x38bdf8,
          width: 1.4,
          alpha: 0.75,
        });
      }

      // Bioluminescent night glow
      if (this.currentSnapshot.climate.solarRadiation < 0.25) {
        g.circle(posX, posY, size * 2.2).fill({ color: colorNum, alpha: 0.22 });
      }
    }

    const nowMs = performance.now();
    this.deathEffects = this.deathEffects.filter((effect) => nowMs - effect.startedAt < 700);
    for (const effect of this.deathEffects) {
      const progress = (nowMs - effect.startedAt) / 700;
      const opacity = 1 - progress;
      g.circle(effect.x, effect.y, effect.radius * (1 - progress * 0.55))
        .fill({ color: effect.color, alpha: opacity * 0.65 });
      g.circle(effect.x, effect.y, effect.radius * (1 + progress * 1.8))
        .stroke({ color: effect.color, width: 1.5, alpha: opacity * 0.7 });
    }
  }

  /**
   * Subtle weather effects: rain streaks and expanding ripple rings.
   */
  private renderSubtleWeather(climate: ClimateState): void {
    const g = this.weatherGraphics;
    g.clear();

    const time = this.animFrameTime;

    // Subtle rainfall streaks when climate has high rainfall
    if (climate.rainfall > 0.35 && !climate.isDrought) {
      const rainIntensity = (climate.rainfall - 0.35) / 0.65;
      const camX = this.camera.current.x;
      const camY = this.camera.current.y;
      const viewW = 900 / this.camera.current.zoom;
      const viewH = 900 / this.camera.current.zoom;

      const rainDrops = Math.floor(45 * rainIntensity);
      for (let r = 0; r < rainDrops; r++) {
        const rx = camX - viewW + (((r * 67 + time * 650) % (viewW * 2)));
        const ry = camY - viewH + (((r * 113 + time * 950) % (viewH * 2)));
        const len = 12 + rainIntensity * 8;

        g.moveTo(rx, ry)
          .lineTo(rx - 3, ry + len)
          .stroke({ color: 0xbfdbfe, width: 0.9, alpha: 0.35 * rainIntensity });

        // Occasional soft water ripple at splash
        if (r % 4 === 0) {
          const ripR = (time * 14 + r * 5) % 10;
          g.ellipse(rx, ry + len, ripR, ripR * 0.4).stroke({
            color: 0xe0f2fe,
            width: 0.6,
            alpha: (1 - ripR / 10) * 0.35 * rainIntensity,
          });
        }
      }
    }
  }

  /**
   * Minimal beautiful particle effects matching season:
   * Spring spores, Summer dust motes, Autumn golden leaves, Winter crystalline flakes.
   */
  private renderSeasonalParticles(climate: ClimateState): void {
    const g = this.particleGraphics;
    g.clear();

    const boundsW = 2560;
    const boundsH = 2560;
    const season = climate.season;

    let particleColor = 0xf0fdf4; // Spring pale green/white spores
    if (season === 'summer') particleColor = 0xfef08a; // Summer sun dust
    else if (season === 'autumn') particleColor = 0xfb923c; // Autumn golden leaves
    else if (season === 'winter') particleColor = 0xe0f2fe; // Winter snowflakes

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x > boundsW) p.x = 0;
      if (p.y < 0) p.y = boundsH;
      if (p.y > boundsH) p.y = 0;

      g.circle(p.x, p.y, p.size).fill({ color: particleColor, alpha: p.alpha });
    }
  }

  /**
   * Soft day and night lighting + Seasonal environmental color washes.
   */
  private renderAtmosphericLighting(climate: ClimateState): void {
    if (!this.terrainMap) return;
    const g = this.atmosphereGraphics;
    g.clear();

    const w = this.terrainMap.worldWidth;
    const h = this.terrainMap.worldHeight;
    const day = climate.dayCycle;

    // Diurnal day-night lighting
    if (day < 0.18) {
      // Warm golden dawn
      const alpha = (1 - day / 0.18) * 0.45;
      g.rect(0, 0, w, h).fill({ color: 0xd97736, alpha: alpha * 0.55 });
    } else if (day >= 0.42 && day < 0.58) {
      // Golden hour & amber dusk
      const prog = (day - 0.42) / 0.16;
      g.rect(0, 0, w, h).fill({ color: 0xb45309, alpha: 0.38 * Math.sin(prog * Math.PI) });
    } else if (day >= 0.58 && day < 0.95) {
      // Deep moonlit indigo night
      const nightIntensity = Math.sin(((day - 0.58) / 0.37) * Math.PI);
      g.rect(0, 0, w, h).fill({ color: 0x050c18, alpha: 0.65 * nightIntensity });
    }

    // Seasonal environmental washes
    if (climate.season === 'spring') {
      g.rect(0, 0, w, h).fill({ color: 0x4ade80, alpha: 0.04 });
    } else if (climate.season === 'summer') {
      g.rect(0, 0, w, h).fill({ color: 0xf59e0b, alpha: 0.05 });
    } else if (climate.season === 'autumn') {
      g.rect(0, 0, w, h).fill({ color: 0xd97706, alpha: 0.06 });
    } else if (climate.season === 'winter') {
      g.rect(0, 0, w, h).fill({ color: 0x93c5fd, alpha: 0.08 });
    }

    // Parched arid solar haze during active drought
    if (climate.isDrought) {
      const droughtAlpha = 0.22 * (climate.droughtSeverity || 0.65);
      g.rect(0, 0, w, h).fill({ color: 0x78350f, alpha: droughtAlpha });
    }
  }

  public destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    if (this.terrainSprite) {
      this.terrainSprite.destroy(true);
      this.terrainSprite = null;
    }
    this.app.destroy(true, { children: true });
  }
}
