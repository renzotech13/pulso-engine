"""Sintetiza el whoosh (1.7 s, pico a 0.6 s) calzado con genflare.py.
Uso: python3 genwhoosh.py <salida.wav>   (requiere numpy)
"""
import sys, numpy as np, wave
SR=48000; TL=1.7; TP=0.6; N=int(TL*SR)
rng=np.random.default_rng(11)
t=np.arange(N)/SR
# envolvente = la misma del destello (sube hasta 0.6 s, cae hasta 1.7 s)
E=np.where(t<TP,(t/TP)**2.2,np.clip(1-(t-TP)/(TL-TP),0,1)**2.2)
# ruido de banda barrida por STFT: centro sube 300->4200 Hz hasta el pico y baja a 900 Hz
noise=rng.normal(0,1,N)
win=2048; hop=512; w=np.hanning(win)
out=np.zeros(N+win)
freqs=np.fft.rfftfreq(win,1/SR)
for s in range(0,N-win,hop):
    tc=(s+win/2)/SR
    if tc<TP: fc=300*(4200/300)**((tc/TP)**1.3)
    else: fc=4200*(900/4200)**((tc-TP)/(TL-TP))
    bw=fc*0.55+200
    H=np.exp(-0.5*((freqs-fc)/bw)**2)
    seg=np.fft.irfft(np.fft.rfft(noise[s:s+win]*w)*H)
    out[s:s+win]+=seg*w
sw=out[:N]; sw/=np.max(np.abs(sw))
sw*=E**0.9
# impacto grave + cola en el pico
bt=np.clip(t-TP,0,None); boom=np.sin(2*np.pi*(52+40*np.exp(-bt*9))*bt)*np.exp(-bt*4.2)*(t>=TP)*np.minimum(1,bt/0.012)*0.55
# brillo agudo (shimmer) tras el pico
sh=np.zeros(N)
for f,a in [(2637,0.10),(3520,0.08),(4699,0.06),(5588,0.05)]:
    sh+=a*np.sin(2*np.pi*f*bt+rng.uniform(0,6.28))*np.exp(-bt*3.0)*(1+0.35*np.sin(2*np.pi*(5+f/2000)*bt))
sh*=(t>=TP)*np.minimum(1,bt/0.03)
mono=sw*0.75+boom+sh
# paneo izquierda -> derecha con el barrido de luz
s=np.clip(t/TL,0,1); s=s*s*(3-2*s); pan=0.15+0.7*s
L=mono*np.sqrt(1-pan); R=mono*np.sqrt(pan)
# fundidos para evitar clics
fi=np.minimum(1,t/0.02); fo=np.minimum(1,(TL-t)/0.08); L*=fi*fo; R*=fi*fo
st=np.stack([L,R],1); st*=0.55/np.max(np.abs(st))
pcm=(st*32767).astype('<i2')
wf=wave.open(sys.argv[1] if len(sys.argv)>1 else "whoosh.wav","wb"); wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes(pcm.tobytes()); wf.close()
print("ok",N/SR)
