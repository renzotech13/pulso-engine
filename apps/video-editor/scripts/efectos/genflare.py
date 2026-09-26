"""Genera 51 PNG (1080x1920) de un light leak/flare: pico blanco a 0.6 s, fin a 1.7 s.
Uso: python3 genflare.py <carpeta-salida> [paleta]      paleta: calido (default) | frio | blanco
(requiere numpy + Pillow). Para una paleta nueva, agregá una entrada a PALETAS.
"""
import sys, os
import numpy as np
from PIL import Image
OUT=sys.argv[1] if len(sys.argv)>1 else '.'; os.makedirs(OUT,exist_ok=True)
PALETAS={
 # leak1,leak2,leak3 (manchas que barren), edge (entra por la izquierda), streak/streak2 (franja anamórfica),
 # core/halo (núcleo), ghosts (4 reflejos de lente), blanco (deslumbre en el corte)
 'calido':dict(leak1=(1.0,0.42,0.07),leak2=(1.0,0.12,0.42),leak3=(1.0,0.78,0.22),edge=(1.0,0.32,0.10),
   streak=(0.80,0.88,1.0),streak2=(1.0,0.72,0.38),core=(1.0,0.97,0.9),halo=(1.0,0.75,0.45),
   ghosts=[(0.35,1.0,0.65),(1.0,0.5,0.9),(0.45,0.65,1.0),(1.0,0.85,0.4)],blanco=(1.0,0.95,0.86)),
 'frio':dict(leak1=(0.10,0.45,1.0),leak2=(0.55,0.25,1.0),leak3=(0.25,0.85,1.0),edge=(0.15,0.40,1.0),
   streak=(0.85,0.93,1.0),streak2=(0.45,0.75,1.0),core=(0.94,0.98,1.0),halo=(0.55,0.8,1.0),
   ghosts=[(0.4,0.8,1.0),(0.7,0.5,1.0),(0.3,1.0,0.9),(0.6,0.7,1.0)],blanco=(0.92,0.97,1.0)),
 'blanco':dict(leak1=(1.0,0.96,0.88),leak2=(0.95,0.95,1.0),leak3=(1.0,0.92,0.75),edge=(1.0,0.95,0.85),
   streak=(1.0,1.0,1.0),streak2=(1.0,0.95,0.85),core=(1.0,1.0,1.0),halo=(1.0,0.96,0.88),
   ghosts=[(1.0,1.0,1.0),(1.0,0.95,0.85),(0.9,0.95,1.0),(1.0,0.97,0.9)],blanco=(1.0,0.98,0.94)),
}
P=PALETAS[sys.argv[2] if len(sys.argv)>2 else 'calido']
W,H=1080,1920; w,h=540,960; FPS=30; N=51; TP=0.6; TL=1.7
u=(np.arange(w)[None,:]+0.5)/h            # unidades de alto (isotrópico)
v=(np.arange(h)[:,None]+0.5)/h
ux=u*1.0; aspect=w/h
rng=np.random.default_rng(7)
def g(cx,cy,sx,sy): return np.exp(-(((ux-cx)/sx)**2+((v-cy)/sy)**2))
def ease(x): x=np.clip(x,0,1); return x*x*(3-2*x)
for i in range(N):
    t=i/FPS
    E = (t/TP)**2.2 if t<TP else (1-(t-TP)/(TL-TP))**2.2
    E=float(np.clip(E,0,1))
    s=ease(t/TL)                               # barrido
    px=-0.25+ (aspect+0.55)*s                  # centro del leak (unidades de alto)
    col=np.zeros((h,w,3),np.float32)
    def add(mask,c,wgt): 
        global col; col+=mask[...,None]*np.array(c,np.float32)*wgt
    add(g(px,0.30,0.42,0.55),P['leak1'],1.15*E)
    add(g(px-0.30,0.58,0.34,0.50),P['leak2'],0.85*E)
    add(g(px+0.28,0.14,0.30,0.42),P['leak3'],0.95*E)
    # borde izquierdo: luz que entra antes del corte
    edge=np.exp(-((ux)/0.22)**2)*np.exp(-((v-0.4)/0.5)**2)
    add(edge,P['edge'],1.0*(E**0.8)*(1-s*0.6))
    # franja anamórfica
    cy=0.36
    A=E**1.4
    add(np.exp(-(((v-cy)/0.005))**2)*np.exp(-np.abs(ux-px)/0.75),P['streak'],1.5*A)
    add(np.exp(-(((v-cy)/0.028))**2)*np.exp(-np.abs(ux-px)/0.55),P['streak2'],0.75*A)
    # núcleo + halo
    r2=((ux-px)**2+(v-cy)**2)
    add(np.exp(-r2/0.0016),P['core'],1.6*E**2)
    add(np.exp(-r2/0.05),P['halo'],0.9*E**1.5)
    # fantasmas (ghosts) por el eje del centro de la imagen
    cxi,cyi=aspect/2,0.5
    for k,(f,rad,c) in enumerate(zip((0.55,1.0,1.45,1.9),(0.05,0.085,0.04,0.11),P['ghosts'])):
        gx=px+(cxi-px)*f; gy=cy+(cyi-cy)*f
        rr=np.sqrt((ux-gx)**2+(v-gy)**2)
        ring=np.exp(-((rr-rad)/(rad*0.22))**2)*0.55+np.exp(-(rr/(rad*0.9))**2)*0.25
        add(ring,c,0.5*E)
    # deslumbre en el corte
    Wh=float(np.exp(-((t-TP)/0.11)**2))*0.92
    col+=Wh*np.array(P['blanco'],np.float32)
    col=1-np.exp(-1.5*col)                     # tonemap suave
    col+=rng.normal(0,0.004,col.shape).astype(np.float32)
    im=Image.fromarray((np.clip(col,0,1)*255).astype(np.uint8)).resize((W,H),Image.BICUBIC)
    im.save(os.path.join(OUT,f"f_{i:03d}.png"))
print("ok",N)
