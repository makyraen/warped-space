# Warped Space

브라우저에서 Plummer 소프트닝 뉴턴 궤도와 Schwarzschild 궤도를 Flamm 포물면 위에서 비교해 보는 프로그램이다. 한국컴퓨터정보학회논문지에 실린 논문 "Warped Space: Flamm 포물면 시각화를 이용한 Plummer 소프트닝 뉴턴 궤도와 Schwarzschild 궤도의 웹 기반 실시간 비교"의 코드이다.

데모: https://makyraen.github.io/warped-space/

## 실행

```
node serve.mjs
```

http://127.0.0.1:8777/ 을 연다. Three.js와 GSAP를 CDN에서 받으므로 인터넷이 필요하고, `index.html`을 파일로 바로 열면 모듈이 막혀 동작하지 않는다.

## 조작

- M을 누르고 화면을 누르고 있으면 질량이 커지고, 떼면 물체가 생긴다. 처음 만든 물체가 중심 질량이다.
- C: 모델 전환 (고무판 / Flamm 포물면)
- V: 시점 전환
- 1~5: 프리셋 배치
- 우클릭: 물체 삭제

논문의 측정을 재현하는 방법은 [measurements/README.md](measurements/README.md)에 있다.
