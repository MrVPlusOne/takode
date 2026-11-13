(()=>{var Q7={subscribe:()=>()=>{}};var R7={typing:6,scrolling:4,message:12};function Y7(C){let H=C>>>0||1;return()=>{return H^=H<<13,H^=H>>>17,H^=H<<5,(H>>>0)/4294967296}}class r{rand;last=null;sceneTime;rate=1;calmUntil=Number.NEGATIVE_INFINITY;idle=0;nextCrane;nextRing;cranes=[];rings=[];constructor(C,H=0){this.rand=Y7(C),this.sceneTime=H,this.nextCrane=this.between(40,90),this.nextRing=this.between(10,30)}noteActivity(C,H){this.calmUntil=Math.max(this.calmUntil,H+R7[C]),this.idle=0}spawn(C,H){if(C==="cranes")this.cranes.push(this.flight(H));if(C==="ring")this.rings.push({x:this.between(0.15,0.85),depth:this.between(0.03,0.12),start:this.sceneTime})}update(C,H,L){let $=this.last===null?0:Math.min(0.5,Math.max(0,C-this.last));this.last=C;let V=C<this.calmUntil,J=V?0.6:1;if(this.rate+=(J-this.rate)*Math.min(1,$*(V?2.5:0.5)),this.sceneTime+=$*this.rate,!V)this.idle+=$;if(this.idle>=15){if(this.nextCrane-=$,this.nextRing-=$,this.nextCrane<=0)this.cranes.push(this.flight(C)),this.nextCrane=this.between(180,420);if(this.nextRing<=0)this.rings.push({x:this.between(0.08,0.92),depth:this.between(0.03,0.14),start:this.sceneTime}),this.nextRing=this.between(25,70)}return this.cranes=this.cranes.filter((q)=>!_7(q,C,H,L)),this.rings=this.rings.filter((q)=>this.sceneTime-q.start<9),{sceneTime:this.sceneTime,cranes:this.cranes,rings:this.rings}}between(C,H){return C+(H-C)*this.rand()}flight(C){let H=this.rand(),L=H<0.4?1:H<0.75?2:3,$=this.between(0.1,0.28),V=[{dx:0,dy:0},{dx:1.1,dy:this.between(0.2,0.45)},{dx:2.1,dy:this.between(-0.25,0.1)}];return{start:C,direction:this.rand()<0.5?1:-1,fromY:$,toY:Math.min(0.32,Math.max(0.08,$+this.between(-0.07,0.07))),speed:this.between(11,16),size:this.between(0.032,0.042),birds:V.slice(0,L).map((J,q)=>({...J,scale:q===0?1:this.between(0.78,0.92),seed:this.between(0,10),glide:this.between(6,10)}))}}}function s(C,H){return Math.min(56,Math.max(28,H*C.size))}function $7(C,H,L){let $=s(C,L),V=L+$*4.5,J=(H-C.start)*C.speed,q=Math.min(1,J/V);return{x:C.direction===-1?L+$*0.75-J:-$*0.75+J,along:q}}function _7(C,H,L,$){return(H-C.start)*C.speed>L+s(C,L)*4.5}function l(C,H,L,$){let{width:V,height:J}=C,q=V/J,M=q<0.75,Q=J*(M?0.84:0.8),U=V*Math.min(2.1,Math.max(1.15,1.15+(1.05-q)*1.3)),Y=V*(M?1.7:q<1.1?1.15:1.02);return{horizon:Q,sun:T7(C,M),far:g(H.far,C,Math.max(V*1.15,J*1.4),Q-J*0.1),midFar:g(H.midFar,C,Math.max(V*1.1,J*1.6),Q-J*0.02),mid:g(H.mid,C,U,Q+J*0.03,M?-0.1:0),near:g(H.near,C,Y,J*(M?1.04:1.1)),boat:A7(C,H.boat,Q,$.sceneTime),...z7(C,H.crane,L,$.cranes)}}function T7(C,H){let{width:L,height:$}=C;return[H?L-Math.max(70,L*0.16):L*0.7,Math.max($*(H?0.11:0.14),110),Math.min(34,Math.max(12,Math.min(L,$)*0.024))]}function g(C,H,L,$,V=0){let J=L*C.height/C.width;return[(H.width-L)/2+V*L,$-J,L,J]}function A7(C,H,L,$){let{width:V,height:J}=C,q=Math.min(110,Math.max(56,V*0.07)),M=q*H.height/H.width,Q=$%300/150,U=Q<1,Y=U?Q:2-Q,T=Y*Y*(3-2*Y),z=V*0.24+T*(V*0.5-q),b=L+J*0.045-M+Math.sin($*0.9)*M*0.04;return U?[z,b,q,M]:[z+q,b,-q,M]}function z7(C,H,L,$){let{width:V,height:J}=C,q=[],M=[];for(let Q of $){let U=s(Q,V),{x:Y,along:T}=$7(Q,L,V),z=T*T*(3-2*T),b=J*(Q.fromY+(Q.toY-Q.fromY)*z)+Math.sin((L-Q.start)*0.21)*J*0.008;for(let I of Q.birds){if(q.length>=12)break;let F=U*I.scale,k=F*H.height*6/H.width,A=S7(L-Q.start+I.seed,I.seed,I.glide),K=Y-Q.direction*I.dx*U;q.push(K,b+I.dy*U+A.lift*k,F*-Q.direction,k),M.push(A.frameA,A.frameB,A.blend,A.tilt*-Q.direction)}}while(q.length<12)q.push(-1e5,-1e5,1,1),M.push(0,0,0,0);return{craneRects:q,cranePoses:M}}var u=[{frame:2,share:0.13},{frame:3,share:0.14},{frame:4,share:0.19},{frame:5,share:0.18},{frame:0,share:0.16},{frame:1,share:0.2}],h=1.15,a=2;function S7(C,H,L){let $=h*a+L,V=((C+H*2.3)%$+$)%$,J=Math.sin(C*0.4+H)*0.035;if(V>=h*a){let U=(V-h*a)/L;return{frameA:2,frameB:2,blend:0,lift:Math.sin(U*Math.PI)*0.045-0.03,tilt:J-Math.sin(U*Math.PI)*0.025}}let q=V%h/h,M=0,Q=0;while(Q<u.length-1&&q>=M+u[Q].share)M+=u[Q].share,Q+=1;return{frameA:u[Q].frame,frameB:u[Q].frame,blend:0,lift:-Math.sin(q*Math.PI*2)*0.035-0.03,tilt:J+Math.sin(q*Math.PI*2)*0.025}}function q7(C){if(!C.getExtension("EXT_color_buffer_float")&&!C.getExtension("EXT_color_buffer_half_float"))return null;let H={advect:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelocityTexel;
uniform float uDt;
uniform float uKeep;
// The band (fractions of the pane height from the top) where the field lasts; outside it, it
// keeps only uOutside a step. Cloud above the valleys meets drier air and evaporates, which is
// what keeps a real sea of clouds lying in the valleys under the peaks.
uniform vec2 uLayer;
uniform float uOutside;
uniform float uPhase;
void main() {
  vec2 back = vUv - uDt * texture2D(uVelocity, vUv).xy * uVelocityTexel;
  float y = 1.0 - vUv.y;
  // The top of the layer rolls gently and slowly, so the sea of clouds has no ruled edge.
  float top = uLayer.x + 0.035 * sin(vUv.x * 7.0 + uPhase) + 0.02 * sin(vUv.x * 17.0 - uPhase * 1.7);
  float outside = 1.0 - smoothstep(top - 0.1, top + 0.1, y) * (1.0 - smoothstep(uLayer.y - 0.03, uLayer.y + 0.03, y));
  gl_FragColor = uKeep * mix(1.0, uOutside, outside) * texture2D(uSource, back);
}
`),diffuse:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uSource;
uniform float uRate;
void main() {
  vec4 c = texture2D(uSource, vUv);
  vec4 around = (texture2D(uSource, vL) + texture2D(uSource, vR) + texture2D(uSource, vT) + texture2D(uSource, vB)) * 0.25;
  gl_FragColor = mix(c, around, uRate);
}
`),curl:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uVelocity, vL).y;
  float r = texture2D(uVelocity, vR).y;
  float t = texture2D(uVelocity, vT).x;
  float b = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}
`),vorticity:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uStrength;
uniform float uDt;
void main() {
  float l = texture2D(uCurl, vL).x;
  float r = texture2D(uCurl, vR).x;
  float t = texture2D(uCurl, vT).x;
  float b = texture2D(uCurl, vB).x;
  float c = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force /= length(force) + 0.0001;
  force *= uStrength * c * vec2(1.0, -1.0);
  vec2 v = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}
`),divergence:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uVelocity, vL).x;
  float r = texture2D(uVelocity, vR).x;
  float t = texture2D(uVelocity, vT).y;
  float b = texture2D(uVelocity, vB).y;
  vec2 c = texture2D(uVelocity, vUv).xy;
  // The sky and the lake are walls the air turns along; the sides stay open, so the breeze blows
  // through instead of piling the clouds up against the far side.
  if (vT.y > 1.0) t = -c.y;
  if (vB.y < 0.0) b = -c.y;
  gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}
`),pressure:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float l = texture2D(uPressure, vL).x;
  float r = texture2D(uPressure, vR).x;
  float t = texture2D(uPressure, vT).x;
  float b = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);
}
`),subtract:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uPressure, vL).x;
  float r = texture2D(uPressure, vR).x;
  float t = texture2D(uPressure, vT).x;
  float b = texture2D(uPressure, vB).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(r - l, t - b);
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`),scale:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uSource;
uniform float uKeep;
void main() {
  gl_FragColor = uKeep * texture2D(uSource, vUv);
}
`),splat:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  vec3 add = uValue * exp(-dot(d, d) / uRadius);
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + add, 1.0);
}
`),current:x(C,`
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDt;
uniform vec2 uWind;
uniform float uEddies;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vUv * vec2(3.0, 2.0) + vec2(uTime * 0.02, -uTime * 0.013);
  float e = 0.05;
  float n = noise(p);
  vec2 swirl = vec2(noise(p + vec2(0.0, e)) - n, -(noise(p + vec2(e, 0.0)) - n)) / e;
  vec2 v = texture2D(uVelocity, vUv).xy + (uWind + swirl * uEddies) * uDt;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`)};if(Object.values(H).some((K)=>!K))return null;let L=C.createBuffer();C.bindBuffer(C.ARRAY_BUFFER,L),C.bufferData(C.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),C.STATIC_DRAW);let $=1,V=null,J=null,q=null,M=null,Q=null,U=[],Y=(K,X,N,P)=>{let j=C.createTexture();C.activeTexture(C.TEXTURE0+15),C.bindTexture(C.TEXTURE_2D,j),C.texParameteri(C.TEXTURE_2D,C.TEXTURE_MIN_FILTER,C.LINEAR),C.texParameteri(C.TEXTURE_2D,C.TEXTURE_MAG_FILTER,C.LINEAR),C.texParameteri(C.TEXTURE_2D,C.TEXTURE_WRAP_S,C.CLAMP_TO_EDGE),C.texParameteri(C.TEXTURE_2D,C.TEXTURE_WRAP_T,C.CLAMP_TO_EDGE),C.texImage2D(C.TEXTURE_2D,0,P,K,X,0,N,C.HALF_FLOAT,null);let G=C.createFramebuffer();C.bindFramebuffer(C.FRAMEBUFFER,G),C.framebufferTexture2D(C.FRAMEBUFFER,C.COLOR_ATTACHMENT0,C.TEXTURE_2D,j,0),C.clearColor(0,0,0,1),C.clear(C.COLOR_BUFFER_BIT);let W={texture:j,framebuffer:G,width:K,height:X};return U.push(W),W},T=(K,X,N,P)=>{let j={read:Y(K,X,N,P),write:Y(K,X,N,P)};return{get read(){return j.read},get write(){return j.write},swap(){[j.read,j.write]=[j.write,j.read]}}},z=()=>{for(let K of U.splice(0))C.deleteTexture(K.texture),C.deleteFramebuffer(K.framebuffer)},b=(K,X)=>{$=Math.max(0.2,K/Math.max(1,X));let N=U.splice(0),P={velocity:V?.read,cloud:q?.read},j=(Z)=>$>=1?[Z,Math.max(8,Math.round(Z/$))]:[Math.max(8,Math.round(Z*$)),Z],[G,W]=j(112),[_,B]=j(448);V=T(G,W,C.RG,C.RG16F),J=T(G,W,C.RED,C.R16F),M=Y(G,W,C.RED,C.R16F),Q=Y(G,W,C.RED,C.R16F),q=T(_,B,C.RED,C.R16F);let w=(Z,f)=>{if(!Z)return;I(H.scale,f,f,(p)=>{C.uniform1i(p("uSource"),F(13,Z)),C.uniform1f(p("uKeep"),1)})};w(P.velocity,V.read),w(P.cloud,q.read);for(let Z of N)C.deleteTexture(Z.texture),C.deleteFramebuffer(Z.framebuffer)},I=(K,X,N,P)=>{C.useProgram(K),C.bindBuffer(C.ARRAY_BUFFER,L);let j=C.getAttribLocation(K,"aPos");C.enableVertexAttribArray(j),C.vertexAttribPointer(j,2,C.FLOAT,!1,0,0);let G=(W)=>C.getUniformLocation(K,W);C.uniform2f(G("uTexel"),1/N.width,1/N.height),P(G),C.bindFramebuffer(C.FRAMEBUFFER,X.framebuffer),C.viewport(0,0,X.width,X.height),C.drawArrays(C.TRIANGLES,0,3)},F=(K,X)=>{return C.activeTexture(C.TEXTURE0+K),C.bindTexture(C.TEXTURE_2D,X.texture),K},k=(K,X,N)=>{I(H.splat,K.write,K.read,(P)=>{C.uniform1i(P("uTarget"),F(13,K.read)),C.uniform2f(P("uPoint"),X.x,1-X.y),C.uniform3f(P("uValue"),N[0],N[1],N[2]),C.uniform1f(P("uRadius"),X.radius*X.radius),C.uniform1f(P("uAspect"),$)}),K.swap()};return{step:(K,X,N,P,j)=>{if(!V||!J||!q||!M||!Q)return;let G=V,W=J,_=q,B=M,w=Q;for(let Z of N){if(Z.push[0]||Z.push[1])k(G,{...Z,radius:Z.radius*1.6},[Z.push[0],-Z.push[1],0]);if(Z.amount)k(_,Z,[Z.amount,0,0])}if(K<=0)return;I(H.current,G.write,G.read,(Z)=>{C.uniform1i(Z("uVelocity"),F(13,G.read)),C.uniform1f(Z("uTime"),X),C.uniform1f(Z("uDt"),K),C.uniform2f(Z("uWind"),P.wind[0],P.wind[1]),C.uniform1f(Z("uEddies"),P.eddies)}),G.swap(),I(H.curl,w,G.read,(Z)=>C.uniform1i(Z("uVelocity"),F(13,G.read))),I(H.vorticity,G.write,G.read,(Z)=>{C.uniform1i(Z("uVelocity"),F(13,G.read)),C.uniform1i(Z("uCurl"),F(14,w)),C.uniform1f(Z("uStrength"),1.2),C.uniform1f(Z("uDt"),K)}),G.swap(),I(H.divergence,B,G.read,(Z)=>C.uniform1i(Z("uVelocity"),F(13,G.read))),I(H.scale,W.write,W.read,(Z)=>{C.uniform1i(Z("uSource"),F(13,W.read)),C.uniform1f(Z("uKeep"),0.8)}),W.swap();for(let Z=0;Z<18;Z++)I(H.pressure,W.write,W.read,(f)=>{C.uniform1i(f("uPressure"),F(13,W.read)),C.uniform1i(f("uDivergence"),F(14,B))}),W.swap();I(H.subtract,G.write,G.read,(Z)=>{C.uniform1i(Z("uPressure"),F(13,W.read)),C.uniform1i(Z("uVelocity"),F(14,G.read))}),G.swap(),I(H.advect,G.write,G.read,(Z)=>{C.uniform1i(Z("uVelocity"),F(13,G.read)),C.uniform1i(Z("uSource"),F(13,G.read)),C.uniform2f(Z("uVelocityTexel"),1/G.read.width,1/G.read.height),C.uniform1f(Z("uDt"),K),C.uniform1f(Z("uKeep"),Math.exp(-K/4)),C.uniform2f(Z("uLayer"),-1,2),C.uniform1f(Z("uOutside"),1),C.uniform1f(Z("uPhase"),0)}),G.swap(),I(H.advect,_.write,_.read,(Z)=>{C.uniform1i(Z("uVelocity"),F(13,G.read)),C.uniform1i(Z("uSource"),F(14,_.read)),C.uniform2f(Z("uVelocityTexel"),1/G.read.width,1/G.read.height),C.uniform1f(Z("uDt"),K),C.uniform1f(Z("uKeep"),Math.exp(-K/P.fade)),C.uniform2f(Z("uLayer"),j[0],j[1]),C.uniform1f(Z("uPhase"),X*0.03),C.uniform1f(Z("uOutside"),Math.exp(-K/4))}),_.swap(),I(H.diffuse,_.write,_.read,(Z)=>{C.uniform1i(Z("uSource"),F(13,_.read)),C.uniform1f(Z("uRate"),Math.min(0.5,K*0.6))}),_.swap()},resize:b,bindClouds:(K)=>{C.activeTexture(C.TEXTURE0+K),C.bindTexture(C.TEXTURE_2D,q?q.read.texture:null)},dispose:()=>{z(),C.deleteBuffer(L);for(let K of Object.values(H))if(K)C.deleteProgram(K)}}}function x(C,H){let L=(q,M)=>{let Q=C.createShader(q);if(C.shaderSource(Q,M),C.compileShader(Q),!C.getShaderParameter(Q,C.COMPILE_STATUS))return console.warn("[scenic] cloud fluid shader failed to compile:",C.getShaderInfoLog(Q)),null;return Q},$=L(C.VERTEX_SHADER,`
attribute vec2 aPos;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 uTexel;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`),V=L(C.FRAGMENT_SHADER,H);if(!$||!V)return null;let J=C.createProgram();return C.attachShader(J,$),C.attachShader(J,V),C.linkProgram(J),C.getProgramParameter(J,C.LINK_STATUS)?J:null}var G7=`
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`,K7=`
precision highp float;
uniform vec2 uRes;      // canvas size in pixels
uniform float uScale;   // canvas pixels per pane pixel
uniform float uTime;    // seconds
uniform float uDark;    // 0 light theme, 1 dark theme

uniform sampler2D uNoise;
uniform sampler2D uPaper;
uniform sampler2D uFar;
uniform sampler2D uMidFar;
uniform sampler2D uMid;
uniform sampler2D uFarNight;    // the same peaks painted moonlit, pale ink on black
uniform sampler2D uMidFarNight;
uniform sampler2D uMidNight;
uniform sampler2D uNear;
uniform sampler2D uBoat;
uniform sampler2D uCrane;   // six wingbeat frames side by side, premultiplied alpha
uniform vec4 uFarRect;
uniform vec4 uMidFarRect;
uniform vec4 uMidRect;
uniform vec4 uNearRect;
uniform vec4 uBoatRect;
uniform float uHorizon;     // lake line, pane pixels
uniform vec3 uSun;          // x, y, radius in pane pixels
uniform vec4 uCraneRect[3]; // centre x, y, width (negative to mirror), height
uniform vec4 uCranePose[3]; // frame a, frame b, blend, tilt (radians)
uniform sampler2D uClouds;  // cloud carried by the fluid simulation (density in red), pane-sized
uniform float uHasClouds;   // 1 when the simulation runs
uniform vec4 uRing[2];      // fish rings on the lake: x (fraction), depth below the lake line (fraction), start, unused
// By day the ink is glazed with light ochre and blue (浅绛山水): the hue each layer's pale washes
// take. Distant ridges, rock, the peaks' tops, the pines, and the water.
const vec3 TINT_FAR = vec3(0.36, 0.47, 0.56);
const vec3 TINT_ROCK = vec3(0.6, 0.43, 0.27);
const vec3 TINT_TOP = vec3(0.38, 0.48, 0.5);
const vec3 TINT_PINE = vec3(0.3, 0.42, 0.36);
const vec3 WATER_TONE = vec3(0.68, 0.73, 0.74);


// Value noise from a tiling texture of random values, smoothstepped between texels.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  return texture2D(uNoise, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 256.0).r;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

vec2 paneSize() { return uRes / uScale; }

float band(float y, float top, float bottom, float soft) {
  return smoothstep(top - soft, top + soft, y) * (1.0 - smoothstep(bottom - soft, bottom + soft, y));
}

// Ink density (0 paper, 1 black ink) of a layer painted as dark ink on white.
// Layers are read everywhere and masked to their rect afterwards, never skipped by an early return:
// a skipped read leaves the mip level of its neighbouring pixels undefined, and the mipmapped boat
// and cranes then drew a faint, flickering dark box along their edges from a coarse level.
float insideRect(vec2 uv) {
  return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
}

float inkAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 uv = (px - rect.xy) / rect.zw;
  return (1.0 - texture2D(tex, uv).r) * insideRect(uv);
}

// Clouds drifting sideways at a pace you can follow (speed in pane heights a second), billowing
// as they go: the warp that shapes them evolves on its own, so their forms roll and change.
float cloud(vec2 q, float speed, float scale, float threshold, float seed) {
  vec2 flow = vec2(uTime * speed, sin(uTime * speed * 3.0 + seed) * 0.02);
  vec2 p = q - flow;
  vec2 warp = vec2(fbm(p * 1.7 + seed + uTime * 0.012), fbm(p * 1.7 + seed + 5.2 - uTime * 0.01));
  float n = fbm(p * vec2(scale, scale * 2.4) + warp * 0.9 + seed);
  return smoothstep(threshold, threshold + 0.16, n);
}

float lightAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 uv = (px - rect.xy) / rect.zw;
  return texture2D(tex, uv).r * insideRect(uv);
}

// A layer's ink density by day (x) and its moonlit brightness at night (y). The painting itself
// never moves: the ink that moves is the simulation's, drawn over it.
vec2 layerInk(sampler2D day, sampler2D night, vec4 rect, vec2 px) {
  return vec2(inkAt(day, rect, px), lightAt(night, rect, px));
}

// Paints a moonlit layer over the night scene so far (premultiplied colour and coverage):
// a peak covers what is behind it with its own pale brushwork.
void over(inout vec4 scene, vec3 color, float cover) {
  scene = vec4(color * cover + scene.rgb * (1.0 - cover), cover + scene.a * (1.0 - cover));
}

// Mist or cloud over the moonlit layers: it can only lighten what it covers. A veil darker than
// bright rock left a sooty fringe on the peaks, which read as smoke.
void veil(inout vec4 scene, vec3 color, float cover) {
  vec3 behind = scene.a > 0.001 ? scene.rgb / scene.a : color;
  over(scene, max(color, behind), cover);
}

// Lays a wash of colour over ink as a painter glazes: the hue changes and the lightness stays, so
// the brushwork reads exactly as in the ink painting.
vec3 glaze(vec3 c, vec3 tint, float amount) {
  return mix(c, c * mix(vec3(1.0), tint / dot(tint, vec3(0.3, 0.59, 0.11)), 0.45), amount);
}

// One crane's colour (premultiplied) and coverage at px.
vec4 crane(vec4 rect, vec4 pose, vec2 px) {
  vec2 d = px - rect.xy;
  float c = cos(-pose.w);
  float s = sin(-pose.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  vec2 uv = d / rect.zw + 0.5;
  // Clamped into its own frame, so a read outside the bird never picks up the next frame.
  vec2 f = clamp(uv, 0.0, 1.0);
  vec4 a = texture2D(uCrane, vec2((pose.x + f.x) / 6.0, f.y));
  vec4 b = texture2D(uCrane, vec2((pose.y + f.x) / 6.0, f.y));
  return mix(a, b, pose.z) * insideRect(uv);
}

// The sea of clouds' lumps and gaps at p (0 a gap, 1 a lump), given where its top lies and the
// slow warp that shapes it. Lumps and wisps travel left with the breeze at a pace you can follow,
// the far ones (near the top) slower than the near ones; each layer moves as a whole, as a
// sheared pattern would smear into streaks over time.
float seaTexture(vec2 p, float topY, vec2 warp) {
  float h = paneSize().y;
  vec2 q = p / h;
  float t = uTime;
  // A finer warp frays every edge: plain value noise leaves lone lumps shaped like diamonds.
  vec2 fray = vec2(noise(q * 14.0 + t * 0.05), noise(q * 14.0 + vec2(7.1, 3.3) - t * 0.05)) - 0.5;
  float far2 = fbm(vec2((q.x + t * 0.009) * 5.0, q.y * 9.0) + warp * 0.8 + fray * 0.45 + 13.0);
  float near2 = fbm(vec2((q.x + t * 0.018) * 4.0, q.y * 7.5) + warp * 0.8 + fray * 0.45);
  // fbm stays near its middle; stretch it so lumps and gaps are clearly shaped.
  return clamp((mix(far2, near2, smoothstep(topY - 0.02 * h, topY + 0.14 * h, p.y)) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 size = paneSize();
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float h = size.y;
  float t = uTime;
  // A slow camera breath; nearer layers move more.
  vec2 drift = vec2(sin(t * 0.014) * 0.008 * size.x, 0.0);
  bool lake = px.y > uHorizon;
  float depth = max(px.y - uHorizon, 0.0) / h;

  // The lake mirrors everything above it, so below the lake line the scene is drawn as seen in
  // the water: from sp, the mirrored point, moved by the ripples.
  vec2 sp = px;
  float rings = 0.0;
  float crest = 0.0;
  float strength = 0.0;
  float glimmer = 0.0;
  if (lake) {
    // Rings where a fish touched the water: they spread, bend the reflection and fade.
    for (int i = 0; i < 2; i++) {
      vec4 ring = uRing[i];
      float age = t - ring.z;
      if (age < 0.0 || age > 9.0) continue;
      vec2 d = (px - vec2(ring.x * size.x, uHorizon + ring.y * h)) * vec2(1.0, 3.2) / h;
      float r = length(d) - age * 0.022;
      rings += sin(r * 180.0) * exp(-r * r / 0.0006) * exp(-age * 0.45);
    }
    // A point on the water itself, so ripples keep their size on the water and crowd together
    // toward the far shore. The perspective is softened, or far ripples would shrink below a
    // pixel and flicker; along the far shore the water lies calm as a mirror.
    float persp = depth + 0.06;
    vec2 wp = vec2((px.x - size.x * 0.5) / h, 1.0) / persp;
    float calm = smoothstep(0.01, 0.07, depth);
    // Rows of small waves running toward you and drifting left with the breeze; their crests
    // waver, and they rise and settle in patches, so the rows break up as real ripples do.
    float swell = noise(vec2(wp.x * 0.7 + t * 0.04, wp.y * 0.6 + t * 0.05));
    // A second, slanting train crosses the first, so the rows never settle into an even pattern.
    float phase = wp.y * 9.0 + t * 0.9 + swell * 7.0;
    float phase2 = wp.y * 13.0 + wp.x * 2.5 + t * 1.2 + swell * 4.0;
    strength = smoothstep(0.25, 0.75, noise(vec2(wp.x * 1.6 + t * 0.06, wp.y * 0.9 - t * 0.04))) * calm;
    crest = sin(phase) * 0.65 + sin(phase2) * 0.35;
    // Each glint lives a second or two, lit and gone at different moments along a row.
    glimmer = smoothstep(0.35, 0.7, noise(vec2(wp.x * 2.5 + wp.y * 0.7, t * 0.6 + wp.y * 1.3)));
    // Each row tilts the mirror image up or down, breaking reflections into soft bands.
    float tilt = (cos(phase) * 0.65 + cos(phase2) * 0.35) * (0.4 + 0.6 * strength) * calm;
    sp = vec2(px.x + (swell - 0.5) * calm * (2.0 + depth * h * 0.08) + rings * 4.0,
      uHorizon - (px.y - uHorizon) * 1.1 + tilt * (2.0 + depth * h * 0.12) + rings * 2.0);
  }
  vec2 sq = sp / h;

  // Back to front, each layer covering what is behind it like ink washes on paper.
  vec3 moon = vec3(0.9, 0.92, 0.97);
  vec3 fog = vec3(0.36, 0.375, 0.4);
  vec4 moonlit = vec4(0.0);
  vec2 farS = layerInk(uFar, uFarNight, uFarRect, sp + drift * 0.25);
  float far = farS.x * 0.7;
  // At night the distant ridges sink toward the sky's tone, so distance reads as it does by day.
  over(moonlit, moon * (0.16 + farS.y * 0.3), smoothstep(0.02, 0.3, farS.x) * 0.7);
  float hazeFar = cloud(sq, 0.006, 1.1, 0.5, 3.0) * band(sp.y, uHorizon - 0.24 * h, uHorizon, 0.06 * h);
  far *= 1.0 - hazeFar * 0.8;
  veil(moonlit, fog, hazeFar * 0.55);
  vec2 midFarS = layerInk(uMidFar, uMidFarNight, uMidFarRect, sp + drift * 0.5);
  float midFar = midFarS.x * 0.75;
  over(moonlit, moon * (0.13 + midFarS.y * 0.5), smoothstep(0.02, 0.3, midFarS.x) * 0.85);
  float peaks = 1.0 - (1.0 - far) * (1.0 - midFar);
  float hazeMid = cloud(sq, 0.009, 1.25, 0.48, 9.0) * band(sp.y, uHorizon - 0.3 * h, uHorizon + 0.02 * h, 0.07 * h);
  peaks *= 1.0 - hazeMid * 0.85;
  veil(moonlit, fog, hazeMid * 0.6);
  vec2 midS = layerInk(uMid, uMidNight, uMidRect, sp + drift);
  float mid = midS.x;
  // The brightest moonlit touches, mostly on the pines' crowns, are held back: drawn large they
  // looked like snow.
  over(moonlit, moon * (midS.y - max(midS.y - 0.6, 0.0) * 0.5), smoothstep(0.02, 0.28, midS.x));
  peaks = 1.0 - (1.0 - peaks) * (1.0 - mid);
  // By day each layer's pale washes take its tint and its darkest strokes stay ink: the far
  // ridges washed blue, the rock warm, the peaks' tops cooler, as a painter lays colour over ink.
  float upper = smoothstep(uHorizon - 0.22 * h, uHorizon - 0.45 * h, sp.y);
  vec3 tint = mix(TINT_FAR, mix(TINT_ROCK, TINT_TOP, upper), clamp(mid * 2.0, 0.0, 1.0));

  // Clouds through the peaks: thin streams high up, and the sea of clouds at their feet.
  float high = cloud(sq, 0.011, 1.3, 0.5, 1.0) * band(sp.y, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h);
  high *= mix(1.0, 0.5, uHasClouds);
  // The sea of clouds has a body and a top. Its top rests higher in the open valley in the middle
  // than against the big masses at the sides, and lobes rise and sink along it. The fluid
  // simulation adds the banks streaming through the valleys and the slow swells. It thins out
  // before the water, so the lake shows below it. A painter leaves the cloud as paper and washes
  // a little grey under the top lobes; at night the moon lights the tops silver.
  float xr = sp.x / size.x;
  float valley = smoothstep(0.08, 0.38, xr) * (1.0 - smoothstep(0.62, 0.92, xr));
  float lobes = fbm(vec2(sq.x * 1.4 + t * 0.012, t * 0.015)) - 0.5;
  float topY = uHorizon - h * (0.13 + 0.07 * valley + lobes * 0.12);
  vec2 warp = vec2(fbm(sq * 1.5 + vec2(t * 0.01, -t * 0.008)), fbm(sq * 1.5 + vec2(5.2, 1.3) - t * 0.009)) - 0.5;
  float n = seaTexture(sp, topY, warp);
  float below = (sp.y - topY) / h;
  // Inside, the sea is solid; its top breaks into lumps and wisps that travel and change.
  float seaBody = smoothstep(-0.05, 0.06, below + (n - 0.5) * 0.15);
  // It lies on the water, with a soft, uneven lower edge that dips and lifts along the shore. Its
  // waviness is measured across the pane's width, so a narrow phone pane gets as much as a wide one.
  float edge = uHorizon + h * (0.045 + (fbm(vec2(xr * 5.0 + t * 0.015, 3.7)) - 0.5) * 0.04 + (n - 0.5) * 0.02);
  seaBody *= 1.0 - smoothstep(edge - 0.03 * h, edge + 0.01 * h, sp.y);
  float sim = texture2D(uClouds, vec2(sp.x, size.y - sp.y) * uScale / uRes).r * uHasClouds
    * (1.0 - smoothstep(uHorizon - 0.02 * h, uHorizon + 0.02 * h, sp.y))
    // The banks it carries cling to the peaks just above the sea, not up in the open sky.
    * smoothstep(topY - 0.14 * h, topY - 0.02 * h, sp.y);
  float density = seaBody * (0.5 + 0.75 * n) + sim * (0.3 + 0.7 * n);
  float cover = smoothstep(0.2, 0.9, density) * uHasClouds;
  // The lumpy tops are the most solid part. Lower down the cloud is thin enough by day and night
  // to show the peaks behind it faintly, as mist does.
  float tops = 1.0 - smoothstep(0.02, 0.18, below);
  peaks *= 1.0 - max(high * 0.85, cover * mix(0.38 + 0.42 * n, 0.92, tops));
  float lit = 0.45 + tops * 0.35 + n * 0.2;
  // A thin moonlit mist hangs around the sea's top, so the gaps between lumps read as mist over
  // rock rather than dark holes in the cloud.
  veil(moonlit, mix(fog * 1.35, moon * 0.62, 0.5), exp(-below * below / 0.02) * 0.8 * uHasClouds);
  // Gaps inside the body stay veiled, and where it meets the water it stays whole: at night,
  // rock seen through a gap, or its reflection, reads as a bruise in the cloud.
  float shoreline = smoothstep(uHorizon - 0.07 * h, uHorizon - 0.01 * h, sp.y);
  // A lone puff floating clear of the sea is faded: by moonlight it stood out as a bright blob.
  float afloat = 1.0 - 0.75 * (1.0 - smoothstep(-0.08, 0.0, below));
  float nightCover = max(cover * mix(0.62 + 0.22 * n, 0.88, tops) * afloat, seaBody * mix(0.65, 0.85, shoreline) * uHasClouds);
  veil(moonlit, mix(fog * 1.2, moon * 0.82, lit), max(high * 0.6, nightCover));
  // A painter's wash in the shadow under each lump: where there is more cloud just above than
  // here, as under an overhang.
  float nAbove = seaTexture(sp - vec2(0.0, 0.025 * h), topY, warp);
  float lobeWash = clamp((nAbove - n) * 2.0, 0.0, 1.0) * seaBody * (1.0 - cover * 0.6);
  float underHigh = cloud(sq - vec2(0.0, 0.014), 0.011, 1.3, 0.5, 1.0)
    * band(sp.y - 0.014 * h, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h) * mix(1.0, 0.5, uHasClouds);
  float shading = max(underHigh - high, 0.0) * 0.22 + lobeWash * 0.14;

  float boat = inkAt(uBoat, uBoatRect, px);
  // Its reflection below the keel, read everywhere and kept only below it (see insideRect).
  float keel = uBoatRect.y + uBoatRect.w * 0.92;
  vec2 m = vec2(px.x + sin(px.y * 0.8 + t * 0.8) * 1.5, keel - (px.y - keel));
  boat = max(boat, inkAt(uBoat, uBoatRect, m) * 0.28 * step(keel, px.y));

  // Near cliffs and pines. Where things stand is this painting's own geometry, in its uv: a
  // cliff at each side with pines on top, and mist at their feet.
  vec2 nearAt = px + drift * 1.6;
  vec2 nuv = (nearAt - uNearRect.xy) / uNearRect.zw;
  // The pines sway in the breeze that carries the clouds left: they lean a little with each gust
  // and their needles stir, more toward the crowns, while trunks and rock stay rooted. Gusts
  // reach the right-hand pine a moment before the left one.
  float pine = nuv.x < 0.5 ? 1.0 - smoothstep(0.06, 0.33, nuv.y) : 1.0 - smoothstep(0.34, 0.52, nuv.y);
  float gust = noise(vec2(t * 0.35 + nuv.x * 1.5, 7.3));
  float bob = sin(t * 0.9 + nuv.x * 3.0 + nuv.y * 4.0) * (0.3 + gust);
  float stir = noise(vec2(px.x * 0.04 + t * 0.9, px.y * 0.05)) - 0.5;
  nearAt.x += ((0.3 + gust) * 0.006 + bob * 0.0015 + stir * 0.002) * uNearRect.z * pine * pine;
  float near = inkAt(uNear, uNearRect, nearAt);
  // The moon catches the upper edges of the cliffs and the pines' needles at night, so their
  // silhouettes, and the pines' sway, show against the dark peaks behind them.
  // Only on the side facing the moon, upper right, and faintly: a full rim made the pines look snowy.
  float nearRim = clamp(near - inkAt(uNear, uNearRect, nearAt + vec2(1.5, -1.5)), 0.0, 1.0);
  float lowMist = cloud(sq, 0.022, 1.1, 0.5, 13.0) * band(px.y, uHorizon - 0.02 * h, size.y + 0.1 * h, 0.06 * h);
  // By day the low mist thins the cliffs' ink. At night it veils them in pale mist instead, since
  // thinning dark rock left dark scalloped lumps that read as smoke.
  near *= 1.0 - lowMist * 0.6 * (1.0 - uDark);
  // The boat passes behind the cliffs rather than over them.
  near = 1.0 - (1.0 - near) * (1.0 - boat * (1.0 - smoothstep(0.15, 0.4, near)));
  // Where the cliffs and the mist at their feet stand in front of the lake, no water shows.
  // Its edge wavers like mist, and the mist thins toward the far shore of the water.
  float waver = (noise(vec2(nuv.y * 9.0, 2.0)) - 0.5) * 0.03 + (noise(vec2(nuv.y * 23.0 + t * 0.05, 5.0)) - 0.5) * 0.012;
  float leftShore = 0.215 + 0.03 * smoothstep(0.6, 0.78, nuv.y) + waver;
  float rightShore = 0.9 - 0.045 * smoothstep(0.5, 0.95, nuv.y) - waver;
  float shore = max(1.0 - smoothstep(leftShore - 0.025, leftShore + 0.015, nuv.x), smoothstep(rightShore - 0.015, rightShore + 0.025, nuv.x))
    * smoothstep(uHorizon - 0.02 * h, uHorizon + 0.1 * h, px.y);

  // Paper texture, and ink soaking unevenly into its fibres.
  float paper = texture2D(uPaper, fract(px / vec2(1024.0, 683.0))).r - 0.5;
  peaks = clamp(peaks * (0.86 + paper * 0.55), 0.0, 1.0);
  near = clamp(near * (0.92 + paper * 0.3), 0.0, 1.0);

  // Paper and sky, with warm light around the sun that slowly breathes.
  float sunDist = length(sp - uSun.xy);
  float breath = 0.5 + 0.5 * sin(t * 0.05);
  float glow = exp(-sunDist / (h * (0.35 + 0.15 * breath)));
  float sky = 1.0 - smoothstep(0.0, uHorizon, sp.y) * 0.35;
  vec3 day = vec3(0.958, 0.944, 0.905) + paper * 0.05;
  // A moonlit night, not a black one: a luminous blue-grey sky that brightens toward the moon.
  vec3 night = vec3(0.2, 0.21, 0.235) * sky + paper * 0.05;
  vec3 color = mix(day, night, uDark) + mix(vec3(0.03, 0.018, -0.01), vec3(0.16, 0.17, 0.19), uDark) * glow;
  float rim = uSun.z * (1.0 + (fbm(vec2(atan(sp.y - uSun.y, sp.x - uSun.x) * 2.0, t * 0.02)) - 0.5) * 0.08);
  float disc = 1.0 - smoothstep(rim * 0.86, rim * 1.04, sunDist);
  float sunWash = 0.88 + 0.12 * fbm((sp - uSun.xy) / uSun.z * 1.6);
  vec3 sunColor = mix(vec3(0.83, 0.42, 0.31), vec3(0.9, 0.9, 0.86), uDark);
  float halo = exp(-max(0.0, sunDist - uSun.z) / (uSun.z * 1.6)) * mix(0.1, 0.18, uDark);
  // The sun or moon stands behind every rock, even pale painted rock.
  float clear = (1.0 - smoothstep(0.03, 0.2, peaks)) * (1.0 - smoothstep(0.03, 0.2, near));
  color = mix(color, sunColor, (disc * sunWash * mix(0.72, 0.85, uDark) + halo) * clear);

  // By day everything is dark ink on paper. At night the distant peaks are pale ink lit by the
  // moon, the clouds glow, and the near cliffs stand dark in front.
  vec3 dayInk = vec3(0.11, 0.105, 0.1);
  // Colour is a day painting: by moonlight it read as floodlit stone, so night stays ink.
  float daylight = 1.0 - uDark;
  vec3 dayColor = mix(glaze(mix(color, dayInk, peaks), tint, daylight * smoothstep(0.03, 0.3, peaks) * (1.0 - smoothstep(0.45, 0.85, peaks))), dayInk, shading);
  // The washes under lumps belong to the day painting; at night they made a sooty rim.
  vec3 nightColor = (color * (1.0 - moonlit.a) + moonlit.rgb) * (1.0 - max(underHigh - high, 0.0) * 0.09);

  // The water: it reflects more of the scene toward the far shore and shows more of itself, a
  // light ink wash, toward you. Ripples facing the sky catch its light in fine lines that break
  // the reflections, and their shaded sides read as faint ink strokes.
  if (lake) {
    float toward = smoothstep(0.0, 0.12, depth);
    // At the cliffs' misty feet the mist hides the ripples.
    float open = 1.0 - shore;
    float reflectance = mix(1.0, 0.35, toward);
    float wash = fbm(vec2(px.x / h * 1.6 - t * 0.008, depth * 12.0)) - 0.5;
    dayColor = mix(WATER_TONE + wash * 0.07, dayColor, reflectance);
    nightColor = mix(vec3(0.17, 0.18, 0.205) + wash * 0.04, nightColor, reflectance);
    float facing = (smoothstep(0.8, 0.95, crest) * strength * glimmer + max(rings, 0.0) * 0.6) * open;
    float shaded = smoothstep(0.8, 0.95, -crest) * strength * toward * open;
    dayColor = mix(dayColor, vec3(0.975, 0.965, 0.935), facing * 0.6);
    dayColor = mix(dayColor, dayInk, shaded * 0.1);
    nightColor = mix(nightColor, vec3(0.5, 0.52, 0.57), facing * 0.35);
    nightColor *= 1.0 - shaded * 0.15;
    // The sun or moon is not mirrored whole: it is high above, so the lake shows it as a path
    // of light toward you, glinting on every wave facing it and widening as it nears.
    float path = exp(-pow((px.x - uSun.x) / (uSun.z * (1.0 + depth * 16.0)), 2.0)) * open;
    float sparkle = smoothstep(0.2, 0.95, crest) * (0.3 + 0.7 * strength) * (0.25 + 0.75 * glimmer);
    float light = path * (0.2 + 0.8 * sparkle) * smoothstep(-0.005, 0.02, depth);
    // By day it glints white on the water; a red path read as streaks.
    dayColor = mix(dayColor, vec3(1.0, 0.985, 0.95), light * 0.7);
    nightColor = mix(nightColor, moon * 0.95, light * 0.6);
  }
  // Mist lying on the water along the far shore, joining the sea of clouds to its reflection.
  float lying = exp(-pow(((px.y - uHorizon) / h - 0.004) / 0.02, 2.0))
    * (0.55 + 0.45 * fbm(vec2(px.x / h * 3.0 + t * 0.02, px.y / h * 20.0)));
  vec3 dayMist = day;
  vec3 nightMist = vec3(0.32, 0.33, 0.365) + paper * 0.04;
  dayColor = mix(dayColor, dayMist, max(lying * 0.6, shore * 0.85));
  // At night the mist on the water can only lighten it; a mist darker than the cloud above drew
  // a dark rule along the shore.
  nightColor = mix(nightColor, max(nightColor, vec3(0.55, 0.57, 0.62) + paper * 0.04), lying * 0.75);
  nightColor = mix(nightColor, nightMist, shore * 0.3);
  color = mix(dayColor, nightColor, uDark);

  // Cranes fly in front of the peaks and behind the near cliffs; thin cloud can veil them.
  for (int i = 0; i < 3; i++) {
    vec4 bird = crane(uCraneRect[i], uCranePose[i], px);
    if (bird.a <= 0.001) continue;
    vec3 body = bird.rgb / bird.a;
    // Moonlit at night: white feathers stay pale, black ones stay dark.
    vec3 nightBody = mix(vec3(0.04), vec3(0.7, 0.71, 0.74), dot(body, vec3(0.3, 0.55, 0.15)));
    body = mix(body, nightBody, uDark);
    // Far away, so a touch of the sky's haze settles on them; they stay opaque.
    body = mix(body, mix(vec3(0.93, 0.92, 0.88), vec3(0.16, 0.165, 0.175), uDark), 0.18);
    color = mix(color, body, bird.a * (1.0 - high * 0.45));
  }

  vec3 nearInk = mix(dayInk, vec3(0.09, 0.095, 0.11), uDark);
  color = mix(color, nearInk, near * mix(1.0, 0.95, uDark));
  color = mix(color, moon * 0.45, nearRim * 0.25 * uDark);
  color = mix(color, max(color, vec3(0.42, 0.44, 0.48)), lowMist * 0.5 * smoothstep(0.1, 0.4, near) * uDark);
  // By day the cliffs' pale washes are warm and the pines' needles a muted green.
  vec3 nearTint = mix(TINT_ROCK, TINT_PINE, smoothstep(0.2, 0.6, pine));
  color = glaze(color, nearTint, daylight * smoothstep(0.05, 0.3, near) * (1.0 - smoothstep(0.45, 0.85, near)));
  // A warm lantern on the boat at night.
  vec2 lantern = vec2(uBoatRect.x + uBoatRect.z * 0.62, uBoatRect.y + uBoatRect.w * 0.45);
  color += vec3(1.0, 0.72, 0.38) * exp(-length(px - lantern) / 4.0) * 0.4 * uDark;
  gl_FragColor = vec4(color, 1.0);
}
`;class t{state;phases;constructor(C){this.state=C>>>0||1,this.phases=[0,1,2,3].map(()=>this.random()*100)}release(C,H,L){if(H<=0)return[];return[L-0.34,L-0.22,L-0.12,L-0.04].map((V,J)=>{let q=this.phases[J],M=J===3?0.55:0.15,Q=M+(1-M)*Math.max(0,Math.sin(C*(0.05+J*0.013)+q))**2;return{x:1.02,y:V+(Math.sin(C*0.07+q)*0.035+Math.sin(C*0.19+q*2)*0.015)*(J===3?0.5:1),amount:(J===3?0.12:0.075)*Q*H,radius:J===3?0.075:0.06,push:[0,0]}})}random(){return this.state^=this.state<<13,this.state^=this.state>>>17,this.state^=this.state<<5,(this.state>>>0)/4294967296}}var o="scenic-ink-moment",D7=12,M7={wind:[-0.9,0],eddies:0.12,fade:40},E7=60,y=(C)=>`${window.TAKODE_INK_ASSETS??"/scenic"}/${C}.v1.webp`,F7={uPaper:y("ink-paper"),uFar:y("ink-far"),uMidFar:y("ink-midfar"),uMid:y("ink-mid"),uFarNight:y("ink-far-night"),uMidFarNight:y("ink-midfar-night"),uMidNight:y("ink-mid-night"),uNear:y("ink-near"),uBoat:y("ink-boat"),uCrane:y("ink-crane")};function P7(C,H){let L={alpha:!1,antialias:!1,powerPreference:"low-power"},$=C.getContext("webgl2",L),V=$??C.getContext("webgl",L);if(!V)return null;let J=k7(V,K7);if(!J)return null;V.useProgram(J);let q=V.createBuffer();V.bindBuffer(V.ARRAY_BUFFER,q),V.bufferData(V.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),V.STATIC_DRAW);let M=V.getAttribLocation(J,"aPos");V.enableVertexAttribArray(M),V.vertexAttribPointer(M,2,V.FLOAT,!1,0,0);let Q=[],U=$?q7($):null,Y=new t(Math.floor(Math.random()*2147483648)),T=null,z=!1,b=0,I=!1,F={width:1,height:1},k=1,A={},K=performance.now(),X=()=>(performance.now()-K)/1000,N=new r(Math.floor(Math.random()*2147483648)),P=[{scale:1,fps:20},{scale:0.75,fps:20},{scale:0.5,fps:15},{scale:0.5,fps:8}],j=0,G=0,W=()=>{let D=C.getBoundingClientRect();k=Math.min(1,window.devicePixelRatio||1)*P[j].scale,C.width=Math.max(1,Math.round(D.width*k)),C.height=Math.max(1,Math.round(D.height*k)),F={width:D.width,height:D.height},V.viewport(0,0,C.width,C.height),U?.resize(F.width,F.height)};W();let _=new Map,B=(D)=>{if(!_.has(D))_.set(D,V.getUniformLocation(J,D));return _.get(D)??null},w=()=>{if(!I||z)return;let D=X(),O=N.update(D,F.width,F.height),R=l(F,{far:A.uFar,midFar:A.uMidFar,mid:A.uMid,near:A.uNear,boat:A.uBoat,crane:A.uCrane},D,O);if(U){let v=R.horizon/F.height,E=[v-0.4,v+0.08];if(T===null)for(let d=O.sceneTime-E7;d<O.sceneTime;d+=0.5)U.step(0.5,d,Y.release(d,0.5,v),M7,E);let L7=T===null?0:Math.min(0.15,Math.max(0,O.sceneTime-T));T=O.sceneTime,U.step(L7,O.sceneTime,Y.release(O.sceneTime,L7,v),M7,E),U.bindClouds(D7)}V.useProgram(J),V.bindFramebuffer(V.FRAMEBUFFER,null),V.viewport(0,0,C.width,C.height),V.bindBuffer(V.ARRAY_BUFFER,q),V.vertexAttribPointer(M,2,V.FLOAT,!1,0,0),V.uniform1i(B("uClouds"),D7),V.uniform1f(B("uHasClouds"),U?1:0),V.uniform2f(B("uRes"),C.width,C.height),V.uniform1f(B("uScale"),k),V.uniform1f(B("uTime"),O.sceneTime),V.uniform1f(B("uDark"),H.dark?1:0),V.uniform1f(B("uHorizon"),R.horizon),V.uniform3fv(B("uSun"),R.sun),V.uniform4fv(B("uFarRect"),R.far),V.uniform4fv(B("uMidFarRect"),R.midFar),V.uniform4fv(B("uMidRect"),R.mid),V.uniform4fv(B("uNearRect"),R.near),V.uniform4fv(B("uBoatRect"),R.boat),V.uniform4fv(B("uCraneRect"),R.craneRects),V.uniform4fv(B("uCranePose"),R.cranePoses);let S=O.rings.slice(-2).flatMap((v)=>[v.x,v.depth,v.start,0]);while(S.length<8)S.push(0,0,-1e4,0);V.uniform4fv(B("uRing"),S),V.drawArrays(V.TRIANGLES,0,3)},Z=0,f=0,p=()=>{let D=Math.min(P[j].fps,document.hasFocus()?P[j].fps:6);Z=window.setTimeout(()=>{b=requestAnimationFrame(I7)},1000/D)},I7=(D)=>{if(p(),document.hidden||window.TAKODE_INK_PAUSED)return;let O=P[j].fps,R=f>0&&document.hasFocus()&&D-f>3000/O;f=D;let S=performance.now();if(w(),G=performance.now()-S>12||R?G+1:Math.max(0,G-1),G>20&&j<P.length-1)j+=1,G=0,W()},e=(D,O,R=!1)=>{let S=V.createTexture();if(Q.push(S),V.activeTexture(V.TEXTURE0+D),V.bindTexture(V.TEXTURE_2D,S),O(),R)V.generateMipmap(V.TEXTURE_2D);V.texParameteri(V.TEXTURE_2D,V.TEXTURE_MIN_FILTER,R?V.LINEAR_MIPMAP_LINEAR:V.LINEAR),V.texParameteri(V.TEXTURE_2D,V.TEXTURE_MAG_FILTER,V.LINEAR)},i=new Uint8Array(65536),m=2654435769;for(let D=0;D<i.length;D++)m^=m<<13,m^=m>>>17,m^=m<<5,i[D]=m>>>0&255;let C7=Object.keys(F7).length;e(C7,()=>{V.texImage2D(V.TEXTURE_2D,0,V.LUMINANCE,256,256,0,V.LUMINANCE,V.UNSIGNED_BYTE,i),V.texParameteri(V.TEXTURE_2D,V.TEXTURE_WRAP_S,V.REPEAT),V.texParameteri(V.TEXTURE_2D,V.TEXTURE_WRAP_T,V.REPEAT)}),V.uniform1i(B("uNoise"),C7);let N7=Object.entries(F7).map(([D,O],R)=>new Promise((S,v)=>{let E=new Image;E.decoding="async",E.crossOrigin="anonymous",E.onload=()=>{if(z)return S();e(R,()=>{V.pixelStorei(V.UNPACK_PREMULTIPLY_ALPHA_WEBGL,D==="uCrane"),V.texImage2D(V.TEXTURE_2D,0,V.RGBA,V.RGBA,V.UNSIGNED_BYTE,E),V.pixelStorei(V.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),V.texParameteri(V.TEXTURE_2D,V.TEXTURE_WRAP_S,V.CLAMP_TO_EDGE),V.texParameteri(V.TEXTURE_2D,V.TEXTURE_WRAP_T,V.CLAMP_TO_EDGE)},$!==null&&(D==="uBoat"||D==="uCrane")),V.useProgram(J),V.uniform1i(B(D),R),A[D]={width:E.naturalWidth,height:E.naturalHeight},S()},E.onerror=()=>v(Error(`could not load ${O}`)),E.src=O}));Promise.all(N7).then(()=>{if(I=!0,w(),H.motion)p()}).catch((D)=>{if(console.warn("[scenic] living ink layers failed to load:",D),!z)H.onFail()});let V7=(D)=>{if(D.preventDefault(),console.warn("[scenic] living ink lost its WebGL context"),!z)H.onFail()};C.addEventListener("webglcontextlost",V7);let H7=new ResizeObserver(()=>{W(),w()});H7.observe(C);let n=(D)=>N.noteActivity(D,X()),Z7=()=>n("typing"),c=()=>n("scrolling");window.addEventListener("keydown",Z7,{capture:!0,passive:!0}),window.addEventListener("wheel",c,{capture:!0,passive:!0}),window.addEventListener("touchmove",c,{capture:!0,passive:!0});let O7=Q7.subscribe((D,O)=>{if(D.messages!==O.messages)n("message")}),J7=(D)=>N.spawn(D.detail,X());return window.addEventListener(o,J7),()=>{z=!0,window.clearTimeout(Z),cancelAnimationFrame(b),H7.disconnect(),window.removeEventListener("keydown",Z7,{capture:!0}),window.removeEventListener("wheel",c,{capture:!0}),window.removeEventListener("touchmove",c,{capture:!0}),O7(),window.removeEventListener(o,J7),C.removeEventListener("webglcontextlost",V7);for(let D of Q)V.deleteTexture(D);U?.dispose(),V.deleteProgram(J),V.deleteBuffer(q)}}function k7(C,H){let L=(q,M)=>{let Q=C.createShader(q);if(C.shaderSource(Q,M),C.compileShader(Q),!C.getShaderParameter(Q,C.COMPILE_STATUS))return console.warn("[scenic] shader failed to compile:",C.getShaderInfoLog(Q)),null;return Q},$=L(C.VERTEX_SHADER,G7),V=L(C.FRAGMENT_SHADER,H);if(!$||!V)return null;let J=C.createProgram();if(C.attachShader(J,$),C.attachShader(J,V),C.linkProgram(J),!C.getProgramParameter(J,C.LINK_STATUS))return console.warn("[scenic] shader failed to link:",C.getProgramInfoLog(J)),null;return J}var j7={圆:"M576 524 443 513C442 657 445 751 245 819L254 833C405 803 475 761 510 707C581 737 626 778 650 814C721 888 878 721 519 690C539 650 542 603 545 550C565 547 574 537 576 524ZM403 375V366H588V395H605C636 395 683 375 684 367V247C702 243 716 235 721 228L624 156L579 204H407L308 164V403H321C360 403 403 382 403 375ZM588 233V337H403V233ZM374 696V471H615V696H632C664 696 715 678 716 671V482C731 480 742 473 747 466L652 394L606 443H379L277 401V725H291C332 725 374 704 374 696ZM775 126V858H218V126ZM218 926V887H775V965H793C837 965 892 937 893 927V145C913 140 927 133 934 124L822 34L765 97H228L103 45V971H123C173 971 218 942 218 926Z",满:"M82 667C71 667 38 667 38 667V687C59 689 75 693 89 703C112 718 116 812 98 918C105 955 128 970 151 970C198 970 231 937 233 887C236 798 196 761 194 706C193 681 200 646 207 614C219 563 277 350 311 236L295 231C132 611 132 611 112 647C101 667 97 667 82 667ZM31 272 23 279C57 314 93 371 104 423C207 492 294 297 31 272ZM106 42 99 48C132 86 171 146 182 201C289 274 382 71 106 42ZM886 265 833 342H286L294 370H500L495 481H420L313 436V970H329C371 970 413 946 413 936V509H493C485 620 466 720 422 813L434 827C486 763 522 697 546 626C556 661 562 699 558 732C578 753 600 748 612 728C601 762 588 796 571 829L583 843C642 774 679 703 703 627C717 671 726 720 721 763C773 820 842 700 715 583C721 559 726 534 730 509H809V835C809 848 805 854 790 854C772 854 693 849 693 849V863C734 870 752 881 764 896C777 911 781 936 783 968C900 958 916 917 916 847V524C934 520 946 513 952 506L846 427L800 481H734C738 445 742 408 744 370H954C968 370 978 365 981 354C947 318 886 265 886 265ZM648 509C644 576 636 638 620 698C622 667 607 624 559 582C566 558 571 534 576 509ZM650 481H580C586 445 590 408 593 370H654ZM866 87 812 164H769V74C797 70 804 61 807 46L664 34V164H543V75C569 71 578 61 580 47L438 34V164H307L315 192H438V321H457C498 321 543 304 543 297V192H664V311H683C724 311 769 294 769 287V192H934C948 192 957 187 960 176C926 140 866 87 866 87Z",済:"M87 659C76 659 42 659 42 659V678C63 680 79 684 94 694C117 709 122 801 103 905C111 942 135 957 157 957C206 957 240 924 242 874C245 786 205 751 202 698C202 673 209 638 218 605C231 555 300 343 339 228L323 225C141 602 141 602 118 638C107 658 103 659 87 659ZM35 260 28 267C63 300 102 356 112 407C215 475 300 278 35 260ZM100 53 92 59C128 91 173 147 187 196C294 255 366 54 100 53ZM860 78 799 160H651C706 127 703 22 512 31L505 37C535 63 565 111 571 156L578 160H309L317 188H430C463 255 508 307 563 348C487 401 388 444 272 475L277 488C322 481 366 474 407 464V626C407 745 385 879 249 972L257 981C414 927 480 835 505 739H729V973H750C794 973 844 952 844 942V500C870 496 879 486 881 473L898 476C908 423 934 387 978 374L979 362C890 358 803 348 724 330C776 290 818 244 848 188H942C956 188 967 183 969 172C929 133 860 78 860 78ZM553 474 419 461C496 443 566 419 627 389C697 427 780 453 873 471L729 458V564H520V500C543 497 551 487 553 474ZM623 299C554 273 495 237 454 188H704C685 229 658 266 623 299ZM512 710C517 682 519 654 520 627V593H729V710Z"};var U7=480,X7=1600,W7=380,r7=2*W7+U7+X7,a7=2*W7+U7+X7*0.55;function B7(C,H,L,$){let V=`seal-${Math.random().toString(36).slice(2,8)}`,J=$?"#d8503c":"#bf3326",q=80+C.length*480,M=C.map((Q,U)=>`<path d="${j7[Q]}" transform="translate(50 ${50+U*480}) scale(0.46)" fill="#fbf3e2"/>`).join("");return`<svg viewBox="0 0 560 ${q}" width="${H}" height="${L}"><defs><filter id="${V}-r" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="10"/></filter><filter id="${V}-w"><feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -12 8.2"/><feComposite in="SourceGraphic" operator="in"/></filter></defs><g filter="url(#${V}-r)"><g filter="url(#${V}-w)"><rect x="18" y="18" width="524" height="${q-36}" rx="34" fill="${J}"/>`+M+"</g></g></svg>"}window.TakodeInk={start:P7,MOMENT_EVENT:o,sealSvg:B7};})();
