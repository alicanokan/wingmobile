
export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyzer: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private stream: MediaStream | null = null;

  async init() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.audioContext.createAnalyser();
    this.analyzer.fftSize = 256;
    
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    source.connect(this.analyzer);

    const bufferLength = this.analyzer.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
  }

  getVolume(): number {
    if (!this.analyzer || !this.dataArray) return 0;
    
    this.analyzer.getByteFrequencyData(this.dataArray);
    
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    
    // Average volume normalized 0-1
    const average = sum / this.dataArray.length;
    return average / 128; // Standardize based on typical 0-255 range
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
