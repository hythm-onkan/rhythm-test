"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_BPM = 80;
const COUNT_IN_BEATS = 4;
const TEST_BEATS = 16;

// iframeの高さを親ページ（WordPress）へ通知
function notifyParentHeight() {
  if (typeof window === "undefined") return;

  const height = document.documentElement.scrollHeight;

  window.parent.postMessage(
    {
      type: "rhythm-test-height",
      height,
    },
    "*"
  );
}

// タップを有効とする最大ズレ
const MAX_MATCH_ERROR = 200;

const BPM_OPTIONS = [
  60,
  70,
  80,
  90,
  100,
  110,
  120,
  130,
  140,
  160,
];

type InputMode = "tap" | "mic";

type Phase =
  | "idle"
  | "countIn"
  | "test"
  | "finished";

export default function Home() {
  // ==========================================
  // iframe高さ自動調整
  // ==========================================

  useEffect(() => {
    notifyParentHeight();

    const observer = new ResizeObserver(() => {
      notifyParentHeight();
    });

    observer.observe(document.documentElement);

    window.addEventListener("load", notifyParentHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", notifyParentHeight);
    };
  }, []);

  // ==========================================
  // モード
  // ==========================================

  const [mode, setMode] =
    useState<InputMode>("tap");

  // ==========================================
  // クリック音 ON / OFF
  // ==========================================

  const [clickEnabled, setClickEnabled] =
    useState(true);

  // ==========================================
  // Phase
  // ==========================================

  const [phase, setPhase] =
    useState<Phase>("idle");

  // ==========================================
  // BPM
  // ==========================================

  const [bpm, setBpm] =
    useState(DEFAULT_BPM);

  const [countIn, setCountIn] =
    useState(COUNT_IN_BEATS);

  const [currentBeat, setCurrentBeat] =
    useState(-1);

  const [tapFlash, setTapFlash] =
    useState(false);

  const [clapDetected, setClapDetected] =
    useState(false);

  const [tapCount, setTapCount] =
    useState(0);

  const [score, setScore] =
    useState<number | null>(null);

  const [averageError, setAverageError] =
    useState<number | null>(null);

  const [stabilityScore, setStabilityScore] =
    useState<number | null>(null);

  const [standardDeviation, setStandardDeviation] =
    useState<number | null>(null);

  const [errors, setErrors] =
    useState<number[]>([]);

  // ==========================================
  // Audio
  // ==========================================

  const audioContextRef =
    useRef<AudioContext | null>(null);

  // ==========================================
  // Microphone
  // ==========================================

  const streamRef =
    useRef<MediaStream | null>(null);

  const analyserRef =
    useRef<AnalyserNode | null>(null);

  const microphoneRef =
    useRef<MediaStreamAudioSourceNode | null>(
      null
    );

  const animationFrameRef =
    useRef<number | null>(null);

  // ==========================================
  // Timer
  // ==========================================

  const timerRef =
    useRef<number | null>(null);

  // ==========================================
  // Phase
  // ==========================================

  const phaseRef =
    useRef<Phase>("idle");

  // ==========================================
  // Beat timing
  // ==========================================

  const beatTimesRef =
    useRef<number[]>([]);

  // ==========================================
  // User input timing
  // ==========================================

  const inputTimesRef =
    useRef<number[]>([]);

  // ==========================================
  // Double input prevention
  // ==========================================

  const lastInputTimeRef =
    useRef<number>(0);

  // ==========================================
  // Microphone volume
  // ==========================================

  const previousVolumeRef =
    useRef<number>(0);

  // ==========================================
  // BPM ref
  // ==========================================

  const bpmRef =
    useRef<number>(DEFAULT_BPM);

  // ==========================================
  // Click setting ref
  // ==========================================

  const clickEnabledRef =
    useRef<boolean>(true);

  // ==========================================
  // Phase変更
  // ==========================================

  const changePhase = (
    newPhase: Phase
  ) => {
    phaseRef.current =
      newPhase;

    setPhase(newPhase);
  };

  // ==========================================
  // クリック音設定変更
  // ==========================================

  const handleClickEnabledChange = (
    enabled: boolean
  ) => {
    // テスト中は変更不可
    if (
      phaseRef.current === "test" ||
      phaseRef.current === "countIn"
    ) {
      return;
    }

    clickEnabledRef.current =
      enabled;

    setClickEnabled(enabled);
  };

  // ==========================================
  // BPM変更
  // ==========================================

  const handleBpmChange = (
    newBpm: number
  ) => {
    if (
      phaseRef.current === "test" ||
      phaseRef.current === "countIn"
    ) {
      return;
    }

    bpmRef.current =
      newBpm;

    setBpm(newBpm);
  };

  // ==========================================
  // 現在のBPMから1拍の長さを計算
  // ==========================================

  const getBeatInterval = () => {
    return 60000 / bpmRef.current;
  };

  // ==========================================
  // AudioContext時刻
  // →
  // performance.now()
  // ==========================================

  const audioTimeToPerformanceTime = (
    audioTime: number
  ): number => {
    const audioContext =
      audioContextRef.current;

    if (!audioContext) {
      return performance.now();
    }

    try {
      const timestamp =
        audioContext.getOutputTimestamp();

      const contextTime =
        timestamp.contextTime;

      const performanceTime =
        timestamp.performanceTime;

      if (
        typeof contextTime === "number" &&
        typeof performanceTime === "number" &&
        Number.isFinite(contextTime) &&
        Number.isFinite(performanceTime)
      ) {
        return (
          performanceTime +
          (audioTime - contextTime) *
            1000
        );
      }
    } catch (error) {
      console.warn(
        "Audio output timestamp unavailable:",
        error
      );
    }

    const currentPerformance =
      performance.now();

    const currentAudio =
      audioContext.currentTime;

    const outputLatency =
      (
        audioContext as AudioContext & {
          outputLatency?: number;
        }
      ).outputLatency ?? 0;

    return (
      currentPerformance +
      (audioTime - currentAudio) *
        1000 +
      outputLatency * 1000
    );
  };

  // ==========================================
  // クリック音
  // ==========================================

  const scheduleClick = (
    audioTime: number,
    accent = false
  ) => {
    const audioContext =
      audioContextRef.current;

    if (!audioContext) {
      return;
    }

    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    oscillator.type = "sine";

    oscillator.frequency.value =
      accent ? 1100 : 750;

    gain.gain.setValueAtTime(
      0.0001,
      audioTime
    );

    gain.gain.exponentialRampToValueAtTime(
      accent ? 0.5 : 0.3,
      audioTime + 0.005
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioTime + 0.08
    );

    oscillator.connect(gain);

    gain.connect(
      audioContext.destination
    );

    oscillator.start(
      audioTime
    );

    oscillator.stop(
      audioTime + 0.1
    );
  };

  // ==========================================
  // 入力登録
  // ==========================================

  const registerInput = (
    timestamp: number
  ) => {
    if (
      phaseRef.current !== "test"
    ) {
      return;
    }

    // 二重入力防止
    if (
      timestamp -
        lastInputTimeRef.current <
      100
    ) {
      return;
    }

    lastInputTimeRef.current =
      timestamp;

    inputTimesRef.current.push(
      timestamp
    );

    setTapCount(
      inputTimesRef.current.length
    );

    setTapFlash(true);

    window.setTimeout(() => {
      setTapFlash(false);
    }, 90);
  };

  // ==========================================
  // タップ
  // ==========================================

  const handleTap = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();

    registerInput(
      performance.now()
    );
  };

  // ==========================================
  // スペースキー
  // ==========================================

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (
        event.code === "Space" &&
        mode === "tap" &&
        phaseRef.current === "test"
      ) {
        event.preventDefault();

        registerInput(
          performance.now()
        );
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [mode]);

  // ==========================================
  // マイク開始
  // ==========================================

  const startMicrophone = async () => {
    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          }
        );

      streamRef.current =
        stream;

      const audioContext =
        audioContextRef.current;

      if (!audioContext) {
        return false;
      }

      const analyser =
        audioContext.createAnalyser();

      analyser.fftSize = 2048;

      analyser.smoothingTimeConstant =
        0.2;

      const microphone =
        audioContext.createMediaStreamSource(
          stream
        );

      microphone.connect(
        analyser
      );

      analyserRef.current =
        analyser;

      microphoneRef.current =
        microphone;

      previousVolumeRef.current =
        0;

      detectClap();

      return true;
    } catch (error) {
      console.error(error);

      alert(
        "マイクへのアクセスが許可されませんでした。"
      );

      return false;
    }
  };

  // ==========================================
  // 手拍子検出
  // ==========================================

  const detectClap = () => {
    const analyser =
      analyserRef.current;

    if (!analyser) {
      return;
    }

    const bufferLength =
      analyser.fftSize;

    const dataArray =
      new Uint8Array(
        bufferLength
      );

    const checkVolume = () => {
      if (
        phaseRef.current !== "test"
      ) {
        animationFrameRef.current =
          requestAnimationFrame(
            checkVolume
          );

        return;
      }

      analyser.getByteTimeDomainData(
        dataArray
      );

      let sum = 0;

      for (
        let i = 0;
        i < bufferLength;
        i++
      ) {
        const value =
          (dataArray[i] - 128) /
          128;

        sum +=
          value * value;
      }

      const rms =
        Math.sqrt(
          sum / bufferLength
        );

      const volume = rms;

      const volumeIncrease =
        volume -
        previousVolumeRef.current;

      const now =
        performance.now();

      if (
        volume > 0.03 &&
        volumeIncrease > 0.01 &&
        now -
          lastInputTimeRef.current >
          180
      ) {
        registerInput(now);

        setClapDetected(true);

        window.setTimeout(() => {
          setClapDetected(false);
        }, 150);
      }

      previousVolumeRef.current =
        previousVolumeRef.current *
          0.8 +
        volume * 0.2;

      animationFrameRef.current =
        requestAnimationFrame(
          checkVolume
        );
    };

    checkVolume();
  };

  // ==========================================
  // 標準偏差
  // ==========================================

  const calculateStandardDeviation = (
    values: number[]
  ): number => {
    if (
      values.length === 0
    ) {
      return 0;
    }

    const mean =
      values.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / values.length;

    const variance =
      values.reduce(
        (sum, value) =>
          sum +
          Math.pow(
            value - mean,
            2
          ),
        0
      ) / values.length;

    return Math.sqrt(
      variance
    );
  };

  // ==========================================
  // タイミング点を計算
  // ==========================================

  const calculateTimingScore = (
    averageAbsoluteError: number
  ) => {
    if (
      averageAbsoluteError <= 15
    ) {
      return 100;
    }

    if (
      averageAbsoluteError <= 30
    ) {
      const ratio =
        (averageAbsoluteError -
          15) /
        15;

      return Math.round(
        100 -
          ratio * 5
      );
    }

    if (
      averageAbsoluteError <= 50
    ) {
      const ratio =
        (averageAbsoluteError -
          30) /
        20;

      return Math.round(
        95 -
          ratio * 10
      );
    }

    if (
      averageAbsoluteError <= 75
    ) {
      const ratio =
        (averageAbsoluteError -
          50) /
        25;

      return Math.round(
        85 -
          ratio * 15
      );
    }

    if (
      averageAbsoluteError <= 100
    ) {
      const ratio =
        (averageAbsoluteError -
          75) /
        25;

      return Math.round(
        70 -
          ratio * 20
      );
    }

    if (
      averageAbsoluteError <= 150
    ) {
      const ratio =
        (averageAbsoluteError -
          100) /
        50;

      return Math.round(
        50 -
          ratio * 25
      );
    }

    if (
      averageAbsoluteError <= 200
    ) {
      const ratio =
        (averageAbsoluteError -
          150) /
        50;

      return Math.round(
        25 -
          ratio * 25
      );
    }

    return 0;
  };

  // ==========================================
  // 採点
  // ==========================================

  const calculateScore = () => {
    const beatTimes =
      beatTimesRef.current;

    const inputTimes =
      inputTimesRef.current;

    const matched: number[] = [];

    const usedInputs =
      new Set<number>();

    // ========================================
    // 各拍に最も近い入力を探す
    // ========================================

    for (
      let i = 0;
      i < beatTimes.length;
      i++
    ) {
      const beat =
        beatTimes[i];

      let closestIndex = -1;

      let closestError =
        Infinity;

      for (
        let j = 0;
        j < inputTimes.length;
        j++
      ) {
        if (
          usedInputs.has(j)
        ) {
          continue;
        }

        const error =
          Math.abs(
            inputTimes[j] -
              beat
          );

        if (
          error <
          closestError
        ) {
          closestError =
            error;

          closestIndex =
            j;
        }
      }

      if (
        closestIndex !== -1 &&
        closestError <=
          MAX_MATCH_ERROR
      ) {
        usedInputs.add(
          closestIndex
        );

        matched.push(
          Math.round(
            inputTimes[
              closestIndex
            ] - beat
          )
        );
      }
    }

    setErrors(matched);

    // ========================================
    // 入力なし
    // ========================================

    if (
      matched.length === 0
    ) {
      setScore(0);

      setAverageError(null);

      setStabilityScore(0);

      setStandardDeviation(null);

      return;
    }

    // ========================================
    // 平均誤差
    // ========================================

    const mean =
      matched.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / matched.length;

    const roundedMean =
      Math.round(mean);

    setAverageError(
      roundedMean
    );

    // ========================================
    // 平均絶対誤差
    // ========================================

    const absoluteErrors =
      matched.map(
        (value) =>
          Math.abs(value)
      );

    const averageAbsoluteError =
      absoluteErrors.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      absoluteErrors.length;

    // ========================================
    // タイミング精度
    // ========================================

    const timingScore =
      calculateTimingScore(
        averageAbsoluteError
      );

    // ========================================
    // 安定度
    // ========================================

    const sd =
      calculateStandardDeviation(
        matched
      );

    const roundedSD =
      Math.round(sd);

    setStandardDeviation(
      roundedSD
    );

    const stability =
      Math.max(
        0,
        Math.min(
          100,
          100 -
            sd * 0.5
        )
      );

    const roundedStability =
      Math.round(
        stability
      );

    setStabilityScore(
      roundedStability
    );

    // ========================================
    // ヒット率
    // ========================================

    const hitRate =
      matched.length /
      TEST_BEATS;

    // ========================================
    // 総合点
    // ========================================

    const rawScore =
      Math.round(
        timingScore * 0.65 +
          roundedStability * 0.15 +
          hitRate * 100 * 0.2
      );

    // ========================================
    // 入力数による上限
    // ========================================

    const scoreLimits: Record<
      number,
      number
    > = {
      0: 0,
      1: 30,
      2: 40,
      3: 50,
      4: 60,
      5: 70,
      6: 80,
      7: 90,
      8: 100,
    };

    const scoreLimit =
      scoreLimits[
        Math.min(
          matched.length,
          TEST_BEATS
        )
      ] ?? 0;

    const finalScore =
      Math.min(
        rawScore,
        scoreLimit
      );

    setScore(
      Math.max(
        0,
        Math.min(
          100,
          finalScore
        )
      )
    );
  };

  // ==========================================
  // テスト開始
  // ==========================================

  const startTest = async () => {
    if (
      phaseRef.current !== "idle" &&
      phaseRef.current !==
        "finished"
    ) {
      return;
    }

    stopAudio();

    const AudioContextClass =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) {
      alert(
        "このブラウザではWeb Audio APIを使用できません。"
      );

      return;
    }

    const audioContext =
      new AudioContextClass();

    await audioContext.resume();

    audioContextRef.current =
      audioContext;

    // ========================================
    // 初期化
    // ========================================

    beatTimesRef.current = [];

    inputTimesRef.current = [];

    lastInputTimeRef.current =
      0;

    previousVolumeRef.current =
      0;

    setTapCount(0);

    setErrors([]);

    setScore(null);

    setAverageError(null);

    setStabilityScore(null);

    setStandardDeviation(null);

    setClapDetected(false);

    // ========================================
    // マイク
    // ========================================

    if (
      mode === "mic"
    ) {
      const microphoneStarted =
        await startMicrophone();

      if (!microphoneStarted) {
        stopAudio();
        return;
      }
    }

    // ========================================
    // プリカウント
    // ========================================

    changePhase(
      "countIn"
    );

    setCurrentBeat(-1);

    setCountIn(
      COUNT_IN_BEATS
    );

    const beatInterval =
      getBeatInterval();

    const startAudioTime =
      audioContext.currentTime +
      0.1;

    let count = 0;

    const runCountIn = () => {
      if (
        count >=
        COUNT_IN_BEATS
      ) {
        const firstBeatAudioTime =
          startAudioTime +
          COUNT_IN_BEATS *
            (beatInterval /
              1000);

        startMainTest(
          firstBeatAudioTime
        );

        return;
      }

      const audioTime =
        startAudioTime +
        count *
          (beatInterval /
            1000);

      // ======================================
      // プリカウントは常にクリックあり
      // ======================================

      scheduleClick(
        audioTime,
        count === 0
      );

      setCountIn(
        COUNT_IN_BEATS -
          count
      );

      count++;

      timerRef.current =
        window.setTimeout(
          runCountIn,
          beatInterval
        );
    };

    runCountIn();
  };

  // ==========================================
  // 本番開始
  // ==========================================

  const startMainTest = (
    firstBeatAudioTime: number
  ) => {
    const audioContext =
      audioContextRef.current;

    if (!audioContext) {
      return;
    }

    changePhase("test");

    beatTimesRef.current = [];

    const beatInterval =
  getBeatInterval() / 2;

    // ========================================
    // 8拍を予約
    // ========================================

    for (
      let i = 0;
      i < TEST_BEATS;
      i++
    ) {
      const audioTime =
        firstBeatAudioTime +
        i *
          (beatInterval /
            1000);

      const performanceTime =
        audioTimeToPerformanceTime(
          audioTime
        );

      beatTimesRef.current.push(
        performanceTime
      );

      // ======================================
      // クリック音の設定
      //
      // ON
      // → 16拍すべて鳴る
      //
      // OFF
      // → 1〜8拍だけ鳴る
      // → 9〜16拍は無音
      // ======================================

      const shouldPlayClick =
        clickEnabledRef.current ||
        i < 8;

      if (shouldPlayClick) {
        scheduleClick(
          audioTime,
          i % 2 === 0
        );
      }
    }

    // ========================================
    // ビート表示
    // ========================================

    const firstBeatPerformanceTime =
      beatTimesRef.current[0];

    const delay =
      Math.max(
        0,
        firstBeatPerformanceTime -
          performance.now()
      );

    const runBeatIndicator = (
      beat: number
    ) => {
      if (
        beat >= TEST_BEATS
      ) {
        return;
      }

      setCurrentBeat(
        beat
      );

      if (
        beat <
        TEST_BEATS - 1
      ) {
        timerRef.current =
          window.setTimeout(
            () => {
              runBeatIndicator(
                beat + 1
              );
            },
            beatInterval
          );
      } else {
        timerRef.current =
          window.setTimeout(
            () => {
              calculateScore();

              changePhase(
                "finished"
              );

              setCurrentBeat(-1);
            },
            beatInterval + 500
          );
      }
    };

    timerRef.current =
      window.setTimeout(
        () => {
          runBeatIndicator(0);
        },
        delay
      );
  };

  // ==========================================
  // 停止
  // ==========================================

  const stopAudio = () => {
    if (
      timerRef.current
    ) {
      clearTimeout(
        timerRef.current
      );

      timerRef.current =
        null;
    }

    if (
      animationFrameRef.current
    ) {
      cancelAnimationFrame(
        animationFrameRef.current
      );

      animationFrameRef.current =
        null;
    }

    streamRef.current
      ?.getTracks()
      .forEach(
        (track) => {
          track.stop();
        }
      );

    streamRef.current =
      null;

    microphoneRef.current
      ?.disconnect();

    microphoneRef.current =
      null;

    analyserRef.current =
      null;

    previousVolumeRef.current =
      0;

    if (
      audioContextRef.current
    ) {
      audioContextRef.current.close();

      audioContextRef.current =
        null;
    }
  };

  // ==========================================
  // 終了時
  // ==========================================

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  // ==========================================
  // タイミングコメント
  // ==========================================

  const getTimingComment = () => {
    if (
      averageError === null
    ) {
      return "";
    }

    if (
      averageError > 40
    ) {
      return "やや後ろにタップする傾向があります。";
    }

    if (
      averageError < -40
    ) {
      return "やや前にタップする傾向があります。";
    }

    return "テンポに対して中心に近いタイミングです。";
  };

  // ==========================================
  // 安定度コメント
  // ==========================================

  const getStabilityComment = () => {
    if (
      stabilityScore === null
    ) {
      return "";
    }

    if (
      stabilityScore >= 90
    ) {
      return "とても安定しています。";
    }

    if (
      stabilityScore >= 75
    ) {
      return "比較的安定しています。";
    }

    if (
      stabilityScore >= 60
    ) {
      return "少しタイミングにばらつきがあります。";
    }

    return "拍ごとのタイミングにばらつきがあります。";
  };

  // ==========================================
  // リズム診断
  // ==========================================

  const getRhythmDiagnosis = () => {
    const inputCount =
      errors.length;

    const average =
      averageError ?? 0;

    const stability =
      stabilityScore ?? 0;

    const sd =
      standardDeviation ?? 999;

    if (inputCount <= 3) {
      return {
        title: "拍感トレーニング型",
        description:
          "まずはクリックの拍をしっかり感じ取るところから始めてみましょう。ゆっくりしたテンポで、1拍ずつクリックと同じタイミングに音を出す練習がおすすめです。",
      };
    }

    if (inputCount <= 5) {
      return {
        title: "リズム定着中型",
        description:
          "クリックに合わせられる場面が増えてきています。まずは8拍すべてを最後まで続けることを意識すると、さらに安定していきます。",
      };
    }

    if (inputCount === 6) {
      return {
        title: "リズム成長型",
        description:
          "基本的な拍を捉える力が身についてきています。入力できる拍を少しずつ増やしながら、最後まで安定して続ける練習をしてみましょう。",
      };
    }

    if (
      Math.abs(average) <= 15 &&
      stability >= 90 &&
      inputCount >= 7
    ) {
      return {
        title: "精密タイミング型",
        description:
          "クリックの中心を非常に正確に捉えています。タイミングの正確さと安定性の両方が高く、非常に優れたリズム感があります。",
      };
    }

    if (
      Math.abs(average) <= 20 &&
      stability >= 85 &&
      inputCount >= 7
    ) {
      return {
        title: "安定タイミング型",
        description:
          "クリックの中心を安定して捉えています。大きなズレも少なく、一定のテンポをキープする力があります。この感覚をさまざまなテンポでも維持してみましょう。",
      };
    }

    if (
      average < -20 &&
      stability >= 85 &&
      inputCount >= 7
    ) {
      return {
        title: "安定した前ノリ型",
        description:
          "タイミングはかなり安定しており、全体的に少し早めに入る傾向があります。前に進むようなリズム感を持っています。必要に応じて、クリックの中心を狙う練習もしてみましょう。",
      };
    }

    if (
      average > 20 &&
      stability >= 85 &&
      inputCount >= 7
    ) {
      return {
        title: "安定した後ノリ型",
        description:
          "タイミングはかなり安定しており、全体的に少し遅めに入る傾向があります。落ち着いたリズム感を持っています。必要に応じて、クリックの中心を狙う練習もしてみましょう。",
      };
    }

    if (
      average <= -20 &&
      stability >= 75 &&
      inputCount >= 7
    ) {
      return {
        title: "前ノリ傾向型",
        description:
          "全体的に少し早めに入る傾向があります。リズムを前に進める感覚がある一方で、拍の中心から少し前に出やすい傾向があります。クリックの中心を意識してみましょう。",
      };
    }

    if (
      average >= 20 &&
      stability >= 75 &&
      inputCount >= 7
    ) {
      return {
        title: "後ノリ傾向型",
        description:
          "全体的に少し遅めに入る傾向があります。落ち着いて拍を捉えられている一方で、拍の中心より少し後ろに入りやすい傾向があります。クリックの中心を意識してみましょう。",
      };
    }

    if (
      stability < 60 &&
      inputCount >= 6
    ) {
      return {
        title: "タイミング変動型",
        description:
          "拍ごとのタイミングにばらつきが見られます。早くなったり遅くなったりしないよう、クリックをよく聴きながら一定のタイミングで音を出す練習がおすすめです。",
      };
    }

    if (
      Math.abs(average) > 70 &&
      inputCount >= 6
    ) {
      return {
        title: "タイミング調整型",
        description:
          "拍を捉えることはできていますが、クリックとのズレがやや大きくなっています。まずはテンポを落として、クリックの瞬間に合わせる感覚を身につけていきましょう。",
      };
    }

    if (
      stability >= 75 &&
      inputCount >= 6
    ) {
      return {
        title: "リズム安定成長型",
        description:
          "基本的なリズム感が身についてきています。拍を捉える力も比較的安定しています。次はテンポを変えても同じタイミングを維持できるように練習してみましょう。",
      };
    }

    return {
      title: "リズムトレーニング型",
      description:
        "基本的な拍を捉える力があります。クリックをよく聴きながら、拍の中心に合わせる練習を続けてみましょう。",
    };
  };

  // ==========================================
  // 画面
  // ==========================================

  const rhythmDiagnosis =
    getRhythmDiagnosis();

  return (
    <main
      lang="ja"
      translate="no"
      className="min-h-screen bg-white text-zinc-900 flex items-center justify-center p-6"
    >
      <div className="w-full max-w-3xl">

        {/* ===================================
            タイトル
        ==================================== */}

        <div className="text-center mb-10">

          <p className="text-sm font-semibold tracking-widest text-zinc-500 mb-3">
            RHYTHM TEST
          </p>

          <h1 className="text-4xl sm:text-5xl font-bold">
            8分音符リズム感チェック
          </h1>

          <p className="mt-4 text-zinc-500">
            あなたのリズム感を測定してみましょう。
          </p>

        </div>

        {/* ===================================
            モード選択
        ==================================== */}

        {(phase === "idle" ||
          phase === "finished") && (

          <div className="flex gap-2 mb-4">

            <button
              type="button"
              onClick={() =>
                setMode("tap")
              }
              className={`flex-1 rounded-xl py-3 font-semibold border ${
                mode === "tap"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-600"
              }`}
            >
              🖱 タップ
            </button>

            <button
              type="button"
              onClick={() =>
                setMode("mic")
              }
              className={`flex-1 rounded-xl py-3 font-semibold border ${
                mode === "mic"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-600"
              }`}
            >
              🎙 マイク
            </button>

          </div>
        )}

        {/* ===================================
            設定
        ==================================== */}

        {(phase === "idle" ||
          phase === "finished") && (

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 mb-4">

            <div className="flex items-center justify-between">

              <div>

                <p className="font-semibold">
                  クリック オフ/オン
                </p>

                <p className="text-xs text-zinc-500 mt-1">
                  {clickEnabled
                    ? "8分音符8回すべてクリックあり"
                    : "4クリックありの後、4クリックなし"}
                </p>

              </div>

              <button
  type="button"
  onClick={() =>
    handleClickEnabledChange(
      !clickEnabled
    )
  }
  aria-pressed={clickEnabled}
  className={`relative flex-shrink-0 w-14 h-8 rounded-full transition-colors ${
    clickEnabled
      ? "bg-zinc-900"
      : "bg-zinc-300"
  }`}
>
  <span
    className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${
      clickEnabled
        ? "translate-x-6"
        : "translate-x-0"
    }`}
  />
</button>

            </div>

            <div className="mt-4 rounded-xl bg-zinc-50 p-4">

              <div className="flex items-center gap-2 text-sm">

                <span className="font-semibold">
                  {clickEnabled
                    ? "ON"
                    : "OFF"}
                </span>

                <span className="text-zinc-500">
                  {clickEnabled
                    ? "クリックを聴きながら8拍"
                    : "4拍目までクリック → 5〜8拍は無音"}
                </span>

              </div>

            </div>

          </div>
        )}

        {/* ===================================
            メインカード
        ==================================== */}

        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-8 sm:p-12 shadow-sm">

          {/* =================================
              BPM
          ================================== */}

          <div className="text-center">

            <p className="text-sm text-zinc-500">
              今回のテンポ
            </p>

            <div className="mt-3 flex items-center justify-center gap-3">

              <select
                value={bpm}
                onChange={(event) =>
                  handleBpmChange(
                    Number(
                      event.target.value
                    )
                  )
                }
                disabled={
                  phase === "countIn" ||
                  phase === "test"
                }
                className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-2xl font-bold text-center outline-none focus:ring-2 focus:ring-zinc-400 disabled:bg-zinc-100 disabled:text-zinc-400"
              >

                {BPM_OPTIONS.map(
                  (option) => (
                    <option
                      key={option}
                      value={option}
                    >
                      {option}
                    </option>
                  )
                )}

              </select>

              <span className="text-xl font-normal text-zinc-500">
                BPM
              </span>

            </div>

          </div>

          {/* =================================
              ビート表示
          ================================== */}

          <div className="h-32 flex items-center justify-center my-6">

            {phase === "countIn" ? (

              <div className="text-center">

                <p className="text-sm text-zinc-500 mb-2">
                  プリカウント
                </p>

                <div className="text-7xl font-bold leading-none">
                  {countIn}
                </div>

              </div>

            ) : (

              <div className="w-full">

                <div className="flex justify-center gap-4">

                  {Array.from({
                    length: TEST_BEATS,
                  }).map(
                    (_, index) => (

                      <div
                        key={index}
                        className={`w-5 h-5 rounded-full transition-all ${
                          currentBeat ===
                          index
                            ? "bg-zinc-900 scale-150"
                            : index % 4 ===
                              0
                            ? "bg-zinc-900"
                            : "bg-zinc-300"
                        }`}
                      />

                    )
                  )}

                </div>

                {/* 無音区間表示 */}

                {phase === "test" &&
                  !clickEnabled && (

                    <p className="text-center text-xs text-zinc-400 mt-5">
                      5〜8拍目は無音です
                    </p>

                  )}

              </div>
            )}

          </div>

          {/* =================================
              TAPボタン
          ================================== */}

          {mode === "tap" &&
            phase !== "finished" && (

              <div className="mt-4">

                <button
                  type="button"
                  onPointerDown={
                    handleTap
                  }
                  style={{
                    touchAction:
                      "manipulation",
                    WebkitTapHighlightColor:
                      "transparent",
                    userSelect:
                      "none",
                  }}
                  className={`w-full h-44 sm:h-48 rounded-3xl text-3xl font-bold transition-transform ${
                    tapFlash
                      ? "bg-zinc-700 text-white scale-[0.97]"
                      : "bg-zinc-900 text-white"
                  }`}
                >
                  TAP!
                </button>

                <p className="text-center text-xs text-zinc-400 mt-3">

                  {phase === "countIn"
                    ? "準備中。本番の1拍目からタップしてください"
                    : phase === "test"
                    ? clickEnabled
                      ? "クリック音に合わせてタップしてください"
                      : currentBeat >= 4
                      ? "無音です。テンポを内部で感じてタップしてください"
                      : "クリック音に合わせてタップしてください"
                    : "スタートするとテストが始まります"}

                </p>

              </div>
            )}

          {/* =================================
              マイク
          ================================== */}

          {mode === "mic" &&
            phase === "test" && (

              <div className="h-44 sm:h-48 rounded-3xl bg-white border border-zinc-200 flex items-center justify-center mt-4">

                {clapDetected ? (

                  <div className="text-center">

                    <div className="text-4xl">
                      👏
                    </div>

                    <p className="font-semibold mt-2">
                      手拍子を検出！
                    </p>

                  </div>

                ) : (

                  <div className="flex items-center gap-3 text-zinc-500">

                    <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />

                    マイク検出中

                  </div>

                )}

              </div>
            )}

          {/* =================================
              プリカウント
          ================================== */}

          {phase === "countIn" && (

            <div className="text-center mt-5">

              <p className="font-semibold">
                準備してください
              </p>

              <p className="text-sm text-zinc-500 mt-1">
                本番の1拍目から入力してください
              </p>

            </div>
          )}

          {/* =================================
              本番
          ================================== */}

          {phase === "test" && (

            <div className="text-center mt-5">

              <p className="font-semibold">

                {mode === "tap"
                  ? "リズムに合わせてタップ！"
                  : "リズムに合わせて手拍子！"}

              </p>

            </div>
          )}

          {/* =================================
              結果
          ================================== */}

          {phase === "finished" && (

            <div className="border-t border-zinc-200 pt-8 mt-8">

              {/* 総合 */}

              <div className="text-center">

                <p className="text-sm text-zinc-500">
                  リズム精度
                </p>

                <div className="text-6xl font-bold mt-2">

                  {score}

                  <span className="text-2xl">
                    点
                  </span>

                </div>

              </div>

              {/* タイミング安定度 */}

              {stabilityScore !== null && (

                <div
                  className={`mt-8 rounded-2xl border p-5 transition-colors ${
                    stabilityScore >= 90
                      ? "bg-green-50 border-green-200"
                      : stabilityScore >= 75
                      ? "bg-blue-50 border-blue-200"
                      : stabilityScore >= 60
                      ? "bg-yellow-50 border-yellow-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >

                  <div className="flex justify-between items-center">

                    <div>

                      <p
                        className={`text-sm ${
                          stabilityScore >= 90
                            ? "text-green-700"
                            : stabilityScore >= 75
                            ? "text-blue-700"
                            : stabilityScore >= 60
                            ? "text-yellow-700"
                            : "text-red-700"
                        }`}
                      >
                        タイミング安定度
                      </p>

                      <p
                        className={`text-3xl font-bold mt-1 ${
                          stabilityScore >= 90
                            ? "text-green-800"
                            : stabilityScore >= 75
                            ? "text-blue-800"
                            : stabilityScore >= 60
                            ? "text-yellow-800"
                            : "text-red-800"
                        }`}
                      >

                        {stabilityScore}

                        <span className="text-base ml-1">
                          点
                        </span>

                      </p>

                    </div>

                    {standardDeviation !== null && (

                      <div className="text-right">

                        <p className="text-xs text-zinc-500">
                          ばらつき
                        </p>

                        <p className="font-semibold text-zinc-800">
                          ±
                          {standardDeviation}
                          ms
                        </p>

                      </div>
                    )}

                  </div>

                  <p className="text-sm text-zinc-600 mt-4">
                    {getStabilityComment()}
                  </p>

                </div>
              )}

              {/* 平均タイミング */}

              {averageError !== null && (

                <div className="mt-4 rounded-2xl bg-white border border-zinc-200 p-5">

                  <p className="text-sm text-zinc-500">
                    平均タイミング
                  </p>

                  <div className="text-3xl font-bold mt-2">

                    {averageError > 0
                      ? `+${averageError}`
                      : averageError}

                    <span className="text-base font-normal ml-1">
                      ms
                    </span>

                  </div>

                  <div className="mt-5">

                    <div className="flex justify-between text-xs text-zinc-400">

                      <span>
                        早い
                      </span>

                      <span>
                        ちょうどいい
                      </span>

                      <span>
                        ゆっくり
                      </span>

                    </div>

                    <div className="relative h-2 bg-zinc-200 rounded-full mt-2">

                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-zinc-500" />

                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-zinc-900"
                        style={{
                          left: `${Math.max(
                            5,
                            Math.min(
                              95,
                              50 +
                                averageError *
                                  0.25
                            )
                          )}%`,
                        }}
                      />

                    </div>

                  </div>

                  <p className="text-sm text-zinc-500 mt-4">
                    {getTimingComment()}
                  </p>

                </div>
              )}

              {/* 各拍 */}

              {errors.length > 0 && (

                <div className="mt-8">

                  <p className="text-sm font-semibold mb-3">
                    各拍のズレ
                  </p>

                  <div className="grid grid-cols-4 gap-2">

                    {errors.map(
                      (
                        error,
                        index
                      ) => (

                        <div
                          key={index}
                          className="rounded-xl bg-white border border-zinc-200 p-3 text-center"
                        >

                          <p className="text-xs text-zinc-400">
                            {index + 1}拍目
                          </p>

                          <p className="font-semibold mt-1">

                            {error > 0
                              ? `+${error}`
                              : error}

                            <span className="text-xs ml-1">
                              ms
                            </span>

                          </p>

                        </div>

                      )
                    )}

                  </div>

                </div>
              )}

              {/* 総評 */}

              {score !== null && (

                <div className="mt-8 rounded-2xl bg-zinc-900 text-white p-6">

                  <p className="text-sm text-zinc-400">
                    リズム診断
                  </p>

                  <p className="text-2xl font-bold mt-2">
                    {rhythmDiagnosis.title}
                  </p>

                  <p className="text-base font-medium text-zinc-200 mt-3 leading-relaxed">
                    {rhythmDiagnosis.description}
                  </p>

                </div>

              )}

            </div>
          )}

          {/* =================================
              スタート
          ================================== */}

          {(phase === "idle" ||
            phase === "finished") && (

            <button
              type="button"
              onClick={
                startTest
              }
              className="w-full mt-8 rounded-2xl bg-zinc-900 text-white py-4 text-lg font-semibold hover:bg-zinc-700 transition"
            >

              {phase === "finished"
                ? "もう一度テスト"
                : "スタート"}

            </button>
          )}

          {/* =================================
              入力数
          ================================== */}

          {(phase === "test" ||
            phase === "finished") && (

            <div className="text-center mt-6">

              <p className="text-sm text-zinc-500">
                検出した入力
              </p>

              <p className="text-3xl font-bold">
                {tapCount}
              </p>

            </div>
          )}

        </div>

        {/* ===================================
            説明
        ==================================== */}

        <p className="text-center text-xs text-zinc-400 mt-8">

          {mode === "tap"
            ? "クリック・タップ・スペースキーで入力できます。"
            : "マイクで手拍子のタイミングを検出します。"}

        </p>

      </div>
    </main>
  );
}