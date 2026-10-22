export type CompanionStatus = { connected: boolean; folder: string; version: string; error: string };
export type Rule = { id: string; airline: string; aircraft: string; costIndex: number };
export type Settings = { simbriefId: string; autoFile: boolean; browser: 'auto' | 'msedge' | 'chrome'; defaultVariants: Record<string, string>; gateProvider: 'aviationstack' | 'flightaware' | 'none'; gateMonthlyLimit: number; rules: Rule[]; hasAviationstackKey?: boolean; hasFlightawareKey?: boolean; aviationstackKey?: string; flightawareKey?: string; removeaviationstackKey?: boolean; removeflightawareKey?: boolean };
export type Variant = { id: string; name: string; icao: string; registration: string; maxPassengers: number | null; source: string };
export type Aircraft = { id: string; icao: string; name: string; maxPassengers: number | null; maxCostIndex: number | null; supportsCostIndex: boolean; variants?: Variant[] };
export type Catalog = { aircraft: Aircraft[]; updatedAt: string; mode: string; warning?: string };
export type Airport = { icao: string; iata: string; name: string; elevation: number | null; lat: number | null; lon: number | null; runway: string; metar: string; metarTime: string; category: string };
export type TimeEvent = { estimated: string | null; scheduled: string | null };
export type LandingContact = { time: string; rateFpm: number | null; method: 'simulator-touchdown' | 'sampled-estimate'; bounce: boolean; groundspeed: number; pitch: number | null; bank: number | null; lat: number; lon: number; sampleAgeMs: number; destinationDistanceNm: number | null };
export type LandingSummary = { startedAt: string; completedAt: string | null; simulator: string; contacts: LandingContact[] };
export type ActualTimings = { out: string | null; off: string | null; on: string | null; in: string | null; phase: 'waiting' | 'taxi-out' | 'airborne' | 'taxi-in' | 'complete'; lastObservedAt: string | null };
export type TelemetryConfig = { simulator: 'auto' | 'simconnect' | 'xplane'; xplanePort: number };
export type TelemetryState = { status: 'idle' | 'waiting' | 'paused' | 'tracking' | 'error'; message: string; planId: string | null; callsign: string; simulator: string; phase: 'waiting' | 'airborne' | 'landed' | 'complete'; config: TelemetryConfig; plan?: Plan; touchdownId?: string; sample?: { receivedAt: string; groundspeed: number; agl: number; verticalSpeed: number; onGround: boolean; parkingBrake: boolean | null } };
export type MapPoint = { ident: string; lat: number | null; lon: number | null };
export type NavFix = MapPoint & { name: string; stage: string; airway: string; altitude: number | null; elapsedSeconds: number | null; eta: string | null; windDirection: number | null; windSpeed: number | null; temperature: number | null; groundspeed: number | null; fuelRemaining: number | null };
export type OfpSummary = {
  airac: string;
  timing: { out: TimeEvent; off: TimeEvent; on: TimeEvent; in: TimeEvent; blockSeconds: number | null; airborneSeconds: number | null; taxiOutSeconds: number | null; taxiInSeconds: number | null; enduranceSeconds: number | null; reserveSeconds: number | null };
  procedures: { departure: { name: string; transition: string; runway: string }; arrival: { name: string; transition: string; runway: string } };
  fuel: { block: number | null; takeoff: number | null; minimumTakeoff: number | null; landing: number | null; taxi: number | null; trip: number | null; contingency: number | null; contingencyRule: string; alternate: number | null; reserve: number | null; extra: number | null; etops: number | null; averageFlow: number | null };
  cruise: { profile: string; climb: string; descent: string; stepClimbs: string; mach: number | null; windDirection: number | null; windSpeed: number | null; windComponent: number | null; isaDeviation: number | null; tropopause: number | null };
  weights: { zeroFuel: number | null; maxZeroFuel: number | null; takeoff: number | null; maxTakeoff: number | null; landing: number | null; maxLanding: number | null; payload: number | null; cargo: number | null };
  navlog: NavFix[];
};
export type Plan = { id: string; staticId: string; generatedAt: string; callsign: string; airline: string; flightNumber: string; aircraft: string; aircraftName: string; aircraftBase: string; registration: string; origin: Airport; destination: Airport; alternate: string; altitude: number; speed: number; costIndex: number | null; passengers: number | null; distance: number | null; route: string; requestedRoute?: string; planningInput?: FlightInput; variantId?: string; variantName?: string; raw: string; wake: string; enroute: string; endurance: string; offBlock: string; blockFuel: number | null; units: string; ofpUrl: string; ofp?: OfpSummary; landing?: LandingSummary; actual?: ActualTimings; filing: { status: 'not-filed' | 'pending' | 'unconfirmed' | 'filed' | 'failed'; message: string; confirmedAt?: string } };
export type Weather = { raw: string; observedAt: string; fetchedAt: string | null; category: string; source: string; stale: boolean; error?: string };
export type Aip = { icao: string; name?: string; elevation?: number | null; frequencies: { frequency: string; name: string; callsign: string }[]; source: string; fetchedAt?: string; error?: string };
export type Gate = { value: string; terminal: string; date: string; historical: boolean; source: string; fetchedAt: string };
export type Gates = { departure: Gate | null; arrival: Gate | null; message?: string; needsKey?: boolean; cached?: boolean };
export type Details = { weather: Record<string, Weather>; airports: Record<string, Aip>; gates: Gates };
export type FlightInput = { airline: string; flightNumber: string; aircraft: string; variant: string; origin: string; destination: string; route: string; date: string; time: string; passengerMode: 'auto' | 'full' | 'custom'; passengers: string; taxiOut: string; taxiIn: string; extraFuel: string; reserve: string; altitude: string; alternate: string };
export type Result = { plan: Plan; details: Details };
export type SimbriefFlight = { id: string; callsign: string; origin: string; destination: string; aircraft: string; registration: string; offBlock: string; generatedAt: string; release: string };
export type Progress = { stage: string; message: string; plan?: Plan; details?: Details; serviceUrl?: string };
declare global {
  interface Window {
    dispatch: {
      bootstrap(): Promise<{ settings: Settings; history: Plan[]; version: string; telemetry: TelemetryState }>;
      catalog(refresh?: boolean): Promise<Catalog>;
      syncAirframes(base: string): Promise<Catalog>;
      airportPositions(ids: string[]): Promise<MapPoint[]>;
      saveSettings(settings: Settings): Promise<Settings>;
      importLatest(): Promise<Result>;
      simbriefFlights(): Promise<SimbriefFlight[]>;
      importSelected(id: string): Promise<Result>;
      generate(input: FlightInput): Promise<Result>;
      cancel(): Promise<boolean>;
      refresh(id: string, kind?: string): Promise<Details | Record<string, Weather> | Gates>;
      file(id: string): Promise<Result>;
      open(url: string): Promise<void>;
      login(service: string): Promise<void>;
      companionStatus(): Promise<CompanionStatus>;
      companionSetup(): Promise<CompanionStatus>;
      startTracking(id: string, config: TelemetryConfig): Promise<TelemetryState>;
      switchTracking(id: string, config: TelemetryConfig): Promise<TelemetryState>;
      followFlight(id: string): Promise<TelemetryState>;
      stopTracking(): Promise<TelemetryState>;
      onTelemetry(callback: (state: TelemetryState) => void): () => void;
      onProgress(callback: (progress: Progress) => void): () => void;
    };
  }
}
