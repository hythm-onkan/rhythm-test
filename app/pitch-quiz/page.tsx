"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/* =========================================================
   基本設定
========================================================= */

const NOTES = [
  { name: "ド", midi: 60, key: "A" },
  { name: "レ", midi: 62, key: "S" },
  { name: "ミ", midi: 64, key: "D" },
  { name: "ファ", midi: 65, key: "F" },
  { name: "ソ", midi: 67, key: "G" },
  { name: "ラ", midi: 69, key: "H" },
  { name: "シ", midi: 71, key: "J" },
  { name: "ド", midi: 72, key: "K" },
];

const TOTAL_QUESTIONS = 5;

const MAX_ANALYZER_HZ = 1000;

const MIN_VOICE_HZ = 120;
const MAX_VOICE_HZ = 1100;

const RMS_THRESHOLD = 0.035;

const NOTE_CONFIRM_COUNT = 3;

const MAX_NOTE_DISTANCE_CENTS = 250;


/* =========================================================
   型
========================================================= */

type Mode = "button" | "mic";

type OctaveMode =
  | "strict"
  | "tolerant";

type MonitorType =
  | "idle"
  | "example"
  | "answer"
  | "mic";

type HintStatus =
  | "none"
  | "good"
  | "warning"
  | "bad";

type QuestionResult = {
  targetIndex: number;
  answerIndex: number | null;
  correct: boolean;

  exampleListens: number;
  answerListens: number;

  cents: number | null;
  answerFrequency: number | null;
};


/* =========================================================
   音程関係
========================================================= */

function midiToFrequency(
  midi: number
) {
  return (
    440 *
    Math.pow(
      2,
      (midi - 69) / 12
    )
  );
}


function frequencyToCents(
  frequency: number,
  targetFrequency: number
) {
  if (
    frequency <= 0 ||
    targetFrequency <= 0
  ) {
    return 0;
  }

  return (
    1200 *
    Math.log2(
      frequency /
        targetFrequency
    )
  );
}


/* =========================================================
   オクターブ許容時のcent計算
========================================================= */

function frequencyToCentsWithOctaveTolerance(
  frequency: number,
  targetFrequency: number
) {
  let cents =
    frequencyToCents(
      frequency,
      targetFrequency
    );

  while (cents > 600) {
    cents -= 1200;
  }

  while (cents < -600) {
    cents += 1200;
  }

  return cents;
}


/* =========================================================
   周波数 → ドレミ
========================================================= */

function getNearestNoteIndex(
  frequency: number,
  octaveTolerant = false
) {
  let bestIndex:
    | number
    | null = null;

  let bestDistance =
    Infinity;

  NOTES.forEach(
    (
      note,
      index
    ) => {

      if (
        octaveTolerant
      ) {

        for (
          let octaveOffset = -3;
          octaveOffset <= 3;
          octaveOffset++
        ) {

          const candidateMidi =
            note.midi +
            octaveOffset * 12;

          const noteFrequency =
            midiToFrequency(
              candidateMidi
            );

          const distance =
            Math.abs(
              frequencyToCents(
                frequency,
                noteFrequency
              )
            );

          if (
            distance <
            bestDistance
          ) {

            bestDistance =
              distance;

            bestIndex =
              index;
          }
        }

      } else {

        const noteFrequency =
          midiToFrequency(
            note.midi
          );

        const distance =
          Math.abs(
            frequencyToCents(
              frequency,
              noteFrequency
            )
          );

        if (
          distance <
          bestDistance
        ) {

          bestDistance =
            distance;

          bestIndex =
            index;
        }
      }
    }
  );

  if (
    bestDistance >
    MAX_NOTE_DISTANCE_CENTS
  ) {
    return null;
  }

  return bestIndex;
}


/* =========================================================
   ヒント
========================================================= */

function getHintStatus(
  cents: number | null,
  currentMode: Mode,
  enabled: boolean,
  targetIndex: number | null = null,
  answerIndex: number | null = null
): HintStatus {
  if (!enabled) {
    return "none";
  }

  /*
   * ボタン回答
   *
   * centではなく「音符が何個離れているか」で判定する。
   *
   * 同じ音       → 緑
   * 1〜2音違い   → 黄色
   * 3音以上違い → 赤
   */
  if (
    currentMode ===
    "button"
  ) {
    if (
      targetIndex === null ||
      answerIndex === null
    ) {
      return "none";
    }

    const noteDistance =
      Math.abs(
        answerIndex -
          targetIndex
      );

    if (
      noteDistance === 0
    ) {
      return "good";
    }

    if (
      noteDistance <= 2
    ) {
      return "warning";
    }

    return "bad";
  }

  /*
   * マイク回答
   *
   * 従来通りcentで判定。
   *
   * ±100cent以内 → 緑
   * ±101〜250cent → 黄色
   * ±251cent以上 → 赤
   */
  if (
    cents === null
  ) {
    return "none";
  }

  const distance =
    Math.abs(cents);

  if (
    distance <= 100
  ) {
    return "good";
  }

  if (
    distance <= 250
  ) {
    return "warning";
  }

  return "bad";
}


/* =========================================================
   ヒントメッセージ
========================================================= */

function getHintMessage(
  cents: number | null,
  currentMode: Mode
) {
  if (
    cents === null
  ) {
    return "";
  }

  const distance =
    Math.abs(cents);


  /*
   * ★ボタンモード
   *
   * 完全一致のみ「その音でOK！」
   *
   * これにより、
   * シ → ド
   * ド → レ
   * などが「OK」にならない。
   */
  if (
    currentMode ===
    "button"
  ) {

    if (
      distance < 1
    ) {
      return "その音でOK！";
    }

    if (
      cents < 0
    ) {
      return "もう少し高く";
    }

    return "もう少し低く";
  }


  /*
   * ★マイクモード
   *
   * ±100cent以内ならOK
   */
  if (
    distance <= 100
  ) {
    return "その音でOK！";
  }

  if (
    cents < 0
  ) {
    return "もう少し高く";
  }

  return "もう少し低く";
}


/* =========================================================
   シャッフル
========================================================= */

function shuffle<T>(
  array: T[]
) {
  const result = [
    ...array,
  ];

  for (
    let i =
      result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      );

    [
      result[i],
      result[j],
    ] = [
      result[j],
      result[i],
    ];
  }

  return result;
}


/* =========================================================
   聴き方スコア
========================================================= */

function getListenScore(
  average: number
) {
  if (
    average <= 1
  ) {
    return 15;
  }

  if (
    average <= 1.5
  ) {
    return 13;
  }

  if (
    average <= 2
  ) {
    return 11;
  }

  if (
    average <= 2.5
  ) {
    return 9;
  }

  if (
    average <= 3
  ) {
    return 7;
  }

  if (
    average <= 4
  ) {
    return 5;
  }

  if (
    average <= 5
  ) {
    return 3;
  }

  return 1;
}


/* =========================================================
   ピッチ検出
========================================================= */

function detectPitch(
  buffer: Float32Array,
  sampleRate: number
) {
  const minFrequency =
    MIN_VOICE_HZ;

  const maxFrequency =
    MAX_VOICE_HZ;

  let mean = 0;

  for (
    let i = 0;
    i < buffer.length;
    i++
  ) {
    mean +=
      buffer[i];
  }

  mean /=
    buffer.length;

  let rms = 0;

  for (
    let i = 0;
    i < buffer.length;
    i++
  ) {
    const value =
      buffer[i] -
      mean;

    rms +=
      value * value;
  }

  rms =
    Math.sqrt(
      rms /
        buffer.length
    );

  if (
    rms <
    RMS_THRESHOLD
  ) {
    return null;
  }

  const minLag =
    Math.floor(
      sampleRate /
        maxFrequency
    );

  const maxLag =
    Math.min(
      Math.floor(
        sampleRate /
          minFrequency
      ),
      buffer.length - 2
    );

  let bestLag = -1;

  let bestCorrelation =
    -Infinity;

  for (
    let lag =
      minLag;
    lag <= maxLag;
    lag++
  ) {
    let sumXY = 0;
    let sumX2 = 0;
    let sumY2 = 0;

    for (
      let i = 0;
      i <
      buffer.length -
        lag;
      i++
    ) {
      const x =
        buffer[i] -
        mean;

      const y =
        buffer[
          i + lag
        ] -
        mean;

      sumXY +=
        x * y;

      sumX2 +=
        x * x;

      sumY2 +=
        y * y;
    }

    if (
      sumX2 === 0 ||
      sumY2 === 0
    ) {
      continue;
    }

    const correlation =
      sumXY /
      Math.sqrt(
        sumX2 *
          sumY2
      );

    if (
      correlation >
      bestCorrelation
    ) {
      bestCorrelation =
        correlation;

      bestLag =
        lag;
    }
  }

  if (
    bestLag === -1 ||
    bestCorrelation <
      0.2
  ) {
    return null;
  }

  const frequency =
    sampleRate /
    bestLag;

  if (
    frequency <
      minFrequency ||
    frequency >
      maxFrequency
  ) {
    return null;
  }

  return frequency;
}


/* =========================================================
   メイン
========================================================= */

export default function PitchQuizPage() {

  /* =======================================================
     State
  ======================================================= */

  const [
    mode,
    setMode,
  ] =
    useState<Mode>(
      "button"
    );

  const [
    octaveMode,
    setOctaveMode,
  ] =
    useState<OctaveMode>(
      "strict"
    );

  const [
    started,
    setStarted,
  ] =
    useState(false);

  const [
    finished,
    setFinished,
  ] =
    useState(false);

  const [
    questionIndexes,
    setQuestionIndexes,
  ] =
    useState<number[]>(
      []
    );

  const [
    question,
    setQuestion,
  ] =
    useState(0);

  const [
    selectedAnswer,
    setSelectedAnswer,
  ] =
    useState<
      number | null
    >(null);

  const [
    exampleListens,
    setExampleListens,
  ] =
    useState(0);

  const [
    answerListens,
    setAnswerListens,
  ] =
    useState(0);

  const [
    results,
    setResults,
  ] =
    useState<
      QuestionResult[]
    >([]);

  const [
    showDetails,
    setShowDetails,
  ] =
    useState(false);

  const [
    micOn,
    setMicOn,
  ] =
    useState(false);

  const [
    micAnswerReady,
    setMicAnswerReady,
  ] =
    useState(false);

  const [
    micError,
    setMicError,
  ] =
    useState("");

  const [
    detectedNoteIndex,
    setDetectedNoteIndex,
  ] =
    useState<
      number | null
    >(null);

  const [
    currentHz,
    setCurrentHz,
  ] =
    useState<
      number | null
    >(null);

  const [
    monitorType,
    setMonitorType,
  ] =
    useState<MonitorType>(
      "idle"
    );

  const [
    hintEnabled,
    setHintEnabled,
  ] =
    useState(false);


  /* =======================================================
     Audio Refs
  ======================================================= */

  const audioContextRef =
    useRef<
      AudioContext | null
    >(null);

  const synthAnalyserRef =
    useRef<
      AnalyserNode | null
    >(null);

  const micAnalyserRef =
    useRef<
      AnalyserNode | null
    >(null);

  const micSpectrumRef =
    useRef<
      AnalyserNode | null
    >(null);

  const micStreamRef =
    useRef<
      MediaStream | null
    >(null);

  const micSourceRef =
    useRef<
      MediaStreamAudioSourceNode | null
    >(null);

  const oscillatorRef =
    useRef<
      OscillatorNode | null
    >(null);

  const gainRef =
    useRef<
      GainNode | null
    >(null);


  /* =======================================================
     状態Ref
  ======================================================= */

  const questionRef =
    useRef(0);

  const questionIndexesRef =
    useRef<number[]>(
      []
    );

  const startedRef =
    useRef(false);

  const modeRef =
    useRef<Mode>(
      "button"
    );

  const octaveModeRef =
    useRef<OctaveMode>(
      "strict"
    );

  const micOnRef =
    useRef(false);

  const micStartingRef =
    useRef(false);

  const mouseMicRef =
    useRef(false);

  const currentHzRef =
    useRef<
      number | null
    >(null);

  const detectedNoteRef =
    useRef<
      number | null
    >(null);

    const selectedAnswerRef =
  useRef<
    number | null
  >(null);

  const candidateNoteRef =
    useRef<
      number | null
    >(null);

  const candidateCountRef =
    useRef(0);

  const lockedMicNoteRef =
    useRef<
      number | null
    >(null);

  const lockedMicHzRef =
    useRef<
      number | null
    >(null);

  const micAnimationRef =
    useRef<
      number | null
    >(null);

  const lastMicUiUpdateRef =
    useRef(0);

  const spaceMicRef =
    useRef(false);

  const canvasRef =
    useRef<
      HTMLCanvasElement | null
    >(null);

  const analyzerAnimationRef =
    useRef<
      number | null
    >(null);

  const appRef =
    useRef<
      HTMLDivElement | null
    >(null);


  /* =======================================================
     State → Ref
  ======================================================= */

  useEffect(() => {
    startedRef.current =
      started;
  }, [
    started,
  ]);

  useEffect(() => {
    modeRef.current =
      mode;
  }, [
    mode,
  ]);

  useEffect(() => {
    octaveModeRef.current =
      octaveMode;
  }, [
    octaveMode,
  ]);

  useEffect(() => {
    questionRef.current =
      question;
  }, [
    question,
  ]);

  useEffect(() => {
    questionIndexesRef.current =
      questionIndexes;
  }, [
    questionIndexes,
  ]);

  useEffect(() => {
    micOnRef.current =
      micOn;
  }, [
    micOn,
  ]);

  useEffect(() => {
  selectedAnswerRef.current =
    selectedAnswer;
}, [
  selectedAnswer,
]);


  /* =======================================================
     WordPress iframe 高さ
  ======================================================= */

  /* =======================================================
   WordPress iframe 高さ自動調整
======================================================= */

useEffect(() => {
  const sendHeight = () => {
    const element = appRef.current;

    if (!element) {
      return;
    }

    /*
     * scale()を使っているため、
     * getBoundingClientRect()だけではなく
     * 実際のコンテンツ高さも確認する。
     */
    const rectHeight =
      element.getBoundingClientRect().height;

    const scrollHeight =
      element.scrollHeight;

    const height = Math.ceil(
      Math.max(
        rectHeight,
        scrollHeight * 0.7
      )
    );

    window.parent.postMessage(
      {
        type: "rhythm-test-height",
        height: height + 20,
      },
      "*"
    );
  };

  /*
   * 初回
   */
  sendHeight();

  /*
   * コンテンツの高さが変わったら更新
   */
  const observer =
    new ResizeObserver(() => {
      sendHeight();
    });

  if (appRef.current) {
    observer.observe(
      appRef.current
    );
  }

  /*
   * 画像・フォント・画面サイズ変更など
   */
  window.addEventListener(
    "resize",
    sendHeight
  );

  /*
   * 少し遅れてもう一度測定
   *
   * WordPress iframe内でフォントやレイアウトが
   *確定した後の高さも取得する。
   */
  const timer1 =
    window.setTimeout(
      sendHeight,
      100
    );

  const timer2 =
    window.setTimeout(
      sendHeight,
      500
    );

  const timer3 =
    window.setTimeout(
      sendHeight,
      1000
    );

  return () => {
    observer.disconnect();

    window.removeEventListener(
      "resize",
      sendHeight
    );

    window.clearTimeout(
      timer1
    );

    window.clearTimeout(
      timer2
    );

    window.clearTimeout(
      timer3
    );
  };

}, [
  started,
  finished,
  showDetails,
  micOn,
  micAnswerReady,
]);


  /* =======================================================
     AudioContext
  ======================================================= */

  const getAudioContext =
    useCallback(() => {

      if (
        audioContextRef.current
      ) {
        return audioContextRef.current;
      }

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (
        !AudioContextClass
      ) {
        throw new Error(
          "このブラウザでは音声機能を利用できません。"
        );
      }

      const context =
        new AudioContextClass();

      audioContextRef.current =
        context;


      const synthAnalyser =
        context.createAnalyser();

      synthAnalyser.fftSize =
        4096;

      synthAnalyser.smoothingTimeConstant =
        0.6;

      synthAnalyser.connect(
        context.destination
      );

      synthAnalyserRef.current =
        synthAnalyser;


      const micAnalyser =
        context.createAnalyser();

      micAnalyser.fftSize =
        2048;

      micAnalyser.smoothingTimeConstant =
        0;

      micAnalyserRef.current =
        micAnalyser;


      const micSpectrum =
        context.createAnalyser();

      micSpectrum.fftSize =
        4096;

      micSpectrum.smoothingTimeConstant =
        0.6;

      micSpectrumRef.current =
        micSpectrum;


      return context;

    }, []);


  /* =======================================================
     音停止
  ======================================================= */

  const stopTone =
    useCallback(() => {

      const context =
        audioContextRef.current;

      const oscillator =
        oscillatorRef.current;

      const gain =
        gainRef.current;

      if (
        !context ||
        !oscillator ||
        !gain
      ) {
        return;
      }

      if (
        context.state ===
        "closed"
      ) {
        oscillatorRef.current =
          null;

        gainRef.current =
          null;

        return;
      }

      try {

        const now =
          context.currentTime;

        gain.gain.cancelScheduledValues(
          now
        );

        gain.gain.setValueAtTime(
          Math.max(
            gain.gain.value,
            0.0001
          ),
          now
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.08
        );

        oscillator.stop(
          now + 0.1
        );

      } catch {
        /* ignore */
      }

      oscillatorRef.current =
        null;

      gainRef.current =
        null;

    }, []);


  /* =======================================================
     音を鳴らす
  ======================================================= */

  const playTone =
    useCallback(
      async (
        midi: number,
        type:
          | "example"
          | "answer"
      ) => {

        const context =
          getAudioContext();

        if (
          context.state ===
          "suspended"
        ) {
          await context.resume();
        }

        stopTone();

        const analyser =
          synthAnalyserRef.current;

        if (!analyser) {
          return;
        }

        const oscillator =
          context.createOscillator();

        const gain =
          context.createGain();

        oscillator.type =
          "triangle";

        oscillator.frequency.value =
          midiToFrequency(
            midi
          );

        const now =
          context.currentTime;

        gain.gain.setValueAtTime(
          0.0001,
          now
        );

        gain.gain.exponentialRampToValueAtTime(
          0.25,
          now + 0.03
        );

        oscillator.connect(
          gain
        );

        gain.connect(
          analyser
        );

        oscillator.start(
          now
        );

        oscillatorRef.current =
          oscillator;

        gainRef.current =
          gain;

        setMonitorType(
          type
        );

        if (
          type === "answer"
        ) {
          const hz =
            midiToFrequency(
              midi
            );

          currentHzRef.current =
            hz;

          setCurrentHz(
            hz
          );
        } else {
          currentHzRef.current =
            null;

          setCurrentHz(
            null
          );
        }

        window.setTimeout(
          () => {

            if (
              oscillatorRef.current ===
              oscillator
            ) {

              stopTone();

              if (
                type ===
                "answer"
              ) {

                currentHzRef.current =
                  null;

                setCurrentHz(
                  null
                );
              }
            }

          },
          700
        );

      },
      [
        getAudioContext,
        stopTone,
      ]
    );


  /* =======================================================
     お手本再生
  ======================================================= */

  const playExample =
    useCallback(() => {

      if (
        !startedRef.current
      ) {
        return;
      }

      const indexes =
        questionIndexesRef.current;

      const currentQuestion =
        questionRef.current;

      const targetIndex =
        indexes[
          currentQuestion
        ];

      if (
        targetIndex ===
        undefined
      ) {
        return;
      }

      setExampleListens(
        value =>
          value + 1
      );

      playTone(
        NOTES[
          targetIndex
        ].midi,
        "example"
      );

    }, [
      playTone,
    ]);


  /* =======================================================
     ボタン回答
  ======================================================= */

  const playAnswer =
    useCallback(
      (
        index: number
      ) => {

        if (
          !startedRef.current
        ) {
          return;
        }

        if (
          modeRef.current !==
          "button"
        ) {
          return;
        }

        setSelectedAnswer(
          index
        );

        selectedAnswerRef.current =
  index;

        setAnswerListens(
          value =>
            value + 1
        );

        playTone(
          NOTES[index].midi,
          "answer"
        );

      },
      [
        playTone,
      ]
    );


  /* =======================================================
     マイク停止
  ======================================================= */

  const stopMic =
    useCallback(() => {

      if (
        micAnimationRef.current !==
        null
      ) {

        cancelAnimationFrame(
          micAnimationRef.current
        );

        micAnimationRef.current =
          null;
      }

      if (
        micSourceRef.current
      ) {

        try {
          micSourceRef.current.disconnect();
        } catch {
          /* ignore */
        }

        micSourceRef.current =
          null;
      }

      if (
        micStreamRef.current
      ) {

        micStreamRef.current
          .getTracks()
          .forEach(
            track => {
              track.stop();
            }
          );

        micStreamRef.current =
          null;
      }

      micStartingRef.current =
        false;

      micOnRef.current =
        false;

      setMicOn(false);

      setCurrentHz(
        null
      );

      setDetectedNoteIndex(
        null
      );

      currentHzRef.current =
        null;

      detectedNoteRef.current =
        null;

      candidateNoteRef.current =
        null;

      candidateCountRef.current =
        0;

      setMonitorType(
        "idle"
      );

    }, []);


  /* =======================================================
     マイク回答固定
  ======================================================= */

  const releaseMic =
    useCallback(() => {

      lockedMicNoteRef.current =
        detectedNoteRef.current;

      lockedMicHzRef.current =
        currentHzRef.current;

      if (
        micAnimationRef.current !==
        null
      ) {

        cancelAnimationFrame(
          micAnimationRef.current
        );

        micAnimationRef.current =
          null;
      }

      if (
        micSourceRef.current
      ) {

        try {
          micSourceRef.current.disconnect();
        } catch {
          /* ignore */
        }

        micSourceRef.current =
          null;
      }

      if (
        micStreamRef.current
      ) {

        micStreamRef.current
          .getTracks()
          .forEach(
            track => {
              track.stop();
            }
          );

        micStreamRef.current =
          null;
      }

      micStartingRef.current =
        false;

      micOnRef.current =
        false;

      setMicOn(false);

      setMicAnswerReady(
        true
      );

      setMonitorType(
        "idle"
      );

    }, []);


  /* =======================================================
     マイク開始
  ======================================================= */

  const startMic =
    useCallback(
      async () => {

        if (
          micStartingRef.current
        ) {
          return;
        }

        micStartingRef.current =
          true;

        try {

          setMicError("");

          setMicAnswerReady(
            false
          );

          lockedMicNoteRef.current =
            null;

          lockedMicHzRef.current =
            null;

          stopMic();

          const context =
            getAudioContext();

          if (
            context.state ===
            "suspended"
          ) {
            await context.resume();
          }

          const stream =
            await navigator.mediaDevices.getUserMedia(
              {
                audio: {
                  echoCancellation:
                    false,

                  noiseSuppression:
                    false,

                  autoGainControl:
                    false,

                  channelCount: 1,
                },
              }
            );

          if (
            !spaceMicRef.current &&
            !mouseMicRef.current &&
            !micOnRef.current
          ) {

            stream
              .getTracks()
              .forEach(
                track =>
                  track.stop()
              );

            micStartingRef.current =
              false;

            return;
          }

          micStreamRef.current =
            stream;

          const source =
            context.createMediaStreamSource(
              stream
            );

          micSourceRef.current =
            source;

          const pitchAnalyser =
            micAnalyserRef.current;

          const spectrumAnalyser =
            micSpectrumRef.current;

          if (
            !pitchAnalyser ||
            !spectrumAnalyser
          ) {
            throw new Error(
              "マイクAnalyzerを初期化できませんでした。"
            );
          }

          source.connect(
            pitchAnalyser
          );

          source.connect(
            spectrumAnalyser
          );

          detectedNoteRef.current =
            null;

          candidateNoteRef.current =
            null;

          candidateCountRef.current =
            0;

          currentHzRef.current =
            null;

          setDetectedNoteIndex(
            null
          );

          setCurrentHz(
            null
          );

          micOnRef.current =
            true;

          setMicOn(
            true
          );

          setMicAnswerReady(
            false
          );

          setMonitorType(
            "mic"
          );


          const detect =
            () => {

              if (
                !micOnRef.current
              ) {
                return;
              }

              const analyser =
                micAnalyserRef.current;

              if (
                !analyser
              ) {
                return;
              }

              const buffer =
                new Float32Array(
                  analyser.fftSize
                );

              analyser.getFloatTimeDomainData(
                buffer
              );

              const frequency =
                detectPitch(
                  buffer,
                  context.sampleRate
                );

              if (
                frequency !==
                null
              ) {

                currentHzRef.current =
                  frequency;

                const noteIndex =
                  getNearestNoteIndex(
                    frequency,
                    octaveModeRef.current ===
                      "tolerant"
                  );

                if (
                  noteIndex !==
                  null
                ) {

                  if (
                    candidateNoteRef.current ===
                    noteIndex
                  ) {

                    candidateCountRef.current +=
                      1;

                  } else {

                    candidateNoteRef.current =
                      noteIndex;

                    candidateCountRef.current =
                      1;
                  }

                  if (
                    candidateCountRef.current >=
                    NOTE_CONFIRM_COUNT
                  ) {

                    detectedNoteRef.current =
                      noteIndex;

                    setDetectedNoteIndex(
                      previous =>
                        previous ===
                        noteIndex
                          ? previous
                          : noteIndex
                    );
                  }

                } else {

                  candidateNoteRef.current =
                    null;

                  candidateCountRef.current =
                    0;

                  detectedNoteRef.current =
                    null;

                  setDetectedNoteIndex(
                    null
                  );
                }

                const now =
                  performance.now();

                if (
                  now -
                    lastMicUiUpdateRef.current >
                  100
                ) {

                  lastMicUiUpdateRef.current =
                    now;

                  setCurrentHz(
                    frequency
                  );
                }

              } else {

                const now =
                  performance.now();

                if (
                  now -
                    lastMicUiUpdateRef.current >
                  120
                ) {

                  lastMicUiUpdateRef.current =
                    now;

                  setCurrentHz(
                    null
                  );
                }
              }

              micAnimationRef.current =
                requestAnimationFrame(
                  detect
                );
            };

          lastMicUiUpdateRef.current =
            0;

          detect();

        } catch (
          error
        ) {

          console.error(
            error
          );

          setMicError(
            "マイクを使用できませんでした。ブラウザのマイク許可を確認してください。"
          );

          stopMic();

        } finally {

          micStartingRef.current =
            false;
        }

      },
      [
        getAudioContext,
        stopMic,
      ]
    );


  /* =======================================================
     マイク押下開始
  ======================================================= */

  const pressMic =
    useCallback(
      async () => {

        if (
          !startedRef.current
        ) {
          return;
        }

        if (
          modeRef.current !==
          "mic"
        ) {
          return;
        }

        if (
          micOnRef.current ||
          micStartingRef.current
        ) {
          return;
        }

        setMicAnswerReady(
          false
        );

        await startMic();

      },
      [
        startMic,
      ]);


  /* =======================================================
     マイク押下終了
  ======================================================= */

  const releaseMicButton =
    useCallback(() => {

      if (
        !micOnRef.current
      ) {
        return;
      }

      releaseMic();

    }, [
      releaseMic,
    ]);


  /* =======================================================
     ゲーム開始
  ======================================================= */

  const startGame =
    useCallback(() => {

      stopMic();

      stopTone();

      mouseMicRef.current =
        false;

      spaceMicRef.current =
        false;

      const indexes =
        shuffle(
          NOTES.map(
            (
              _,
              index
            ) =>
              index
          )
        ).slice(
          0,
          TOTAL_QUESTIONS
        );

      questionIndexesRef.current =
        indexes;

      questionRef.current =
        0;

      setQuestionIndexes(
        indexes
      );

      setQuestion(
        0
      );

      setSelectedAnswer(
        null
      );

      selectedAnswerRef.current =
  null;

      setExampleListens(
        1
      );

      setAnswerListens(
        0
      );

      setResults(
        []
      );

      setFinished(
        false
      );

      setShowDetails(
        false
      );

      setMicAnswerReady(
        false
      );

      setDetectedNoteIndex(
        null
      );

      setCurrentHz(
        null
      );

      currentHzRef.current =
        null;

      detectedNoteRef.current =
        null;

      candidateNoteRef.current =
        null;

      candidateCountRef.current =
        0;

      lockedMicNoteRef.current =
        null;

      lockedMicHzRef.current =
        null;

      setMonitorType(
        "example"
      );

      setStarted(
        true
      );

      window.setTimeout(
        () => {

          playTone(
            NOTES[
              indexes[0]
            ].midi,
            "example"
          );

        },
        150
      );

    }, [
      playTone,
      stopMic,
      stopTone,
    ]);


  /* =======================================================
     次の問題
  ======================================================= */

  const goToNextQuestion =
    useCallback(
      (
        result: QuestionResult
      ) => {

        const nextResults =
          [
            ...results,
            result,
          ];

        setResults(
          nextResults
        );

        if (
          question + 1 >=
          TOTAL_QUESTIONS
        ) {

          stopMic();

          stopTone();

          setFinished(
            true
          );

          setMonitorType(
            "idle"
          );

          return;
        }

        const nextQuestion =
          question + 1;

        const nextTarget =
          questionIndexes[
            nextQuestion
          ];

        questionRef.current =
          nextQuestion;

        setQuestion(
          nextQuestion
        );

        setSelectedAnswer(
          null
        );

        selectedAnswerRef.current =
  null;

        setExampleListens(
          1
        );

        setAnswerListens(
          0
        );

        setMicAnswerReady(
          false
        );

        setDetectedNoteIndex(
          null
        );

        setCurrentHz(
          null
        );

        currentHzRef.current =
          null;

        detectedNoteRef.current =
          null;

        candidateNoteRef.current =
          null;

        candidateCountRef.current =
          0;

        lockedMicNoteRef.current =
          null;

        lockedMicHzRef.current =
          null;

        stopMic();

        setMonitorType(
          "example"
        );

        if (
          nextTarget !==
          undefined
        ) {

          window.setTimeout(
            () => {

              playTone(
                NOTES[
                  nextTarget
                ].midi,
                "example"
              );

            },
            400
          );
        }

      },
      [
        playTone,
        question,
        questionIndexes,
        results,
        stopMic,
        stopTone,
      ]
    );


  /* =======================================================
     ボタン回答確定
  ======================================================= */

  const submitButton =
    useCallback(() => {

      if (
        selectedAnswer ===
        null
      ) {
        return;
      }

      const targetIndex =
        questionIndexes[
          question
        ];

      if (
        targetIndex ===
        undefined
      ) {
        return;
      }

      const cents =
        (
          NOTES[
            selectedAnswer
          ].midi -
          NOTES[
            targetIndex
          ].midi
        ) * 100;

      const result:
        QuestionResult =
        {
          targetIndex,

          answerIndex:
            selectedAnswer,

          /*
           * ボタン回答は完全一致のみ正解
           */
          correct:
            selectedAnswer ===
            targetIndex,

          exampleListens,

          answerListens,

          cents,

          answerFrequency:
            null,
        };

      goToNextQuestion(
        result
      );

    }, [
      selectedAnswer,
      questionIndexes,
      question,
      exampleListens,
      answerListens,
      goToNextQuestion,
    ]);


  /* =======================================================
     マイク回答確定
  ======================================================= */

  const submitMic =
    useCallback(() => {

      const answerIndex =
        lockedMicNoteRef.current;

      if (
        answerIndex ===
        null
      ) {
        return;
      }

      const targetIndex =
        questionIndexes[
          question
        ];

      if (
        targetIndex ===
        undefined
      ) {
        return;
      }

      const frequency =
        lockedMicHzRef.current;

      let cents:
        | number
        | null = null;

      if (
        frequency !==
        null
      ) {

        cents =
          octaveModeRef.current ===
            "tolerant"

            ? frequencyToCentsWithOctaveTolerance(
                frequency,
                midiToFrequency(
                  NOTES[
                    targetIndex
                  ].midi
                )
              )

            : frequencyToCents(
                frequency,
                midiToFrequency(
                  NOTES[
                    targetIndex
                  ].midi
                )
              );
      }

      const result:
        QuestionResult =
        {
          targetIndex,

          answerIndex,

          correct:
            octaveModeRef.current ===
            "tolerant"

              ? NOTES[
                  answerIndex
                ].name ===
                NOTES[
                  targetIndex
                ].name

              : answerIndex ===
                targetIndex,

          exampleListens,

          answerListens:
            1,

          cents,

          answerFrequency:
            frequency,
        };

      stopMic();

      goToNextQuestion(
        result
      );

    }, [
      exampleListens,
      goToNextQuestion,
      question,
      questionIndexes,
      stopMic,
    ]);


  /* =======================================================
     ボタン回答キーボード
  ======================================================= */

  useEffect(() => {

    const handleKeyDown =
      (
        event: KeyboardEvent
      ) => {

        if (
          !startedRef.current
        ) {
          return;
        }

        if (
          modeRef.current !==
          "button"
        ) {
          return;
        }

        if (
          event.repeat
        ) {
          return;
        }

        if (
          event.code ===
          "Space"
        ) {
          event.preventDefault();
          return;
        }

        const key =
          event.key.toUpperCase();

        const index =
          NOTES.findIndex(
            note =>
              note.key ===
              key
          );

        if (
          index === -1
        ) {
          return;
        }

        event.preventDefault();

        playAnswer(
          index
        );
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

  }, [
    playAnswer,
  ]);


  /* =======================================================
     Spaceキー
  ======================================================= */

  useEffect(() => {

    const handleKeyDown =
      (
        event: KeyboardEvent
      ) => {

        if (
          event.code !==
          "Space"
        ) {
          return;
        }

        if (
          !startedRef.current ||
          modeRef.current !==
            "mic"
        ) {
          return;
        }

        event.preventDefault();

        if (
          event.repeat ||
          spaceMicRef.current
        ) {
          return;
        }

        spaceMicRef.current =
          true;

        pressMic();
      };

    const handleKeyUp =
      (
        event: KeyboardEvent
      ) => {

        if (
          event.code !==
          "Space"
        ) {
          return;
        }

        if (
          !spaceMicRef.current
        ) {
          return;
        }

        event.preventDefault();

        spaceMicRef.current =
          false;

        releaseMicButton();
      };

    window.addEventListener(
      "keydown",
      handleKeyDown,
      {
        passive: false,
      }
    );

    window.addEventListener(
      "keyup",
      handleKeyUp,
      {
        passive: false,
      }
    );

    return () => {

      window.removeEventListener(
        "keydown",
        handleKeyDown
      );

      window.removeEventListener(
        "keyup",
        handleKeyUp
      );

    };

  }, [
    pressMic,
    releaseMicButton,
  ]);


  /* =======================================================
     Analyzer
  ======================================================= */

  useEffect(() => {

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      return;
    }

    const resize =
      () => {

        const rect =
          canvas.getBoundingClientRect();

        const dpr =
          window.devicePixelRatio ||
          1;

        canvas.width =
          Math.max(
            1,
            Math.floor(
              rect.width *
                dpr
            )
          );

        canvas.height =
          Math.max(
            1,
            Math.floor(
              rect.height *
                dpr
            )
          );

        ctx.setTransform(
          dpr,
          0,
          0,
          dpr,
          0,
          0
        );
      };

    resize();

    const draw =
      () => {

        const width =
          canvas.clientWidth;

        const height =
          canvas.clientHeight;

        ctx.clearRect(
          0,
          0,
          width,
          height
        );

        ctx.fillStyle =
          "#0b1020";

        ctx.fillRect(
          0,
          0,
          width,
          height
        );

        ctx.strokeStyle =
          "rgba(255,255,255,0.1)";

        ctx.lineWidth =
          1;

        for (
          let i = 0;
          i <= 4;
          i++
        ) {

          const y =
            (height / 4) *
            i;

          ctx.beginPath();

          ctx.moveTo(
            0,
            y
          );

          ctx.lineTo(
            width,
            y
          );

          ctx.stroke();
        }

        for (
          let hz = 0;
          hz <=
          MAX_ANALYZER_HZ;
          hz += 200
        ) {

          const x =
            (hz /
              MAX_ANALYZER_HZ) *
            width;

          ctx.beginPath();

          ctx.moveTo(
            x,
            0
          );

          ctx.lineTo(
            x,
            height
          );

          ctx.stroke();
        }

        const analyser =
          micOnRef.current
            ? micSpectrumRef.current
            : synthAnalyserRef.current;

        if (
          analyser
        ) {

          const data =
            new Uint8Array(
              analyser.frequencyBinCount
            );

          analyser.getByteFrequencyData(
            data
          );

          const sampleRate =
            analyser.context.sampleRate;

          const nyquist =
            sampleRate / 2;

          const maxBin =
            Math.min(
              data.length - 1,
              Math.floor(
                (MAX_ANALYZER_HZ /
                  nyquist) *
                  data.length
              )
            );

          if (
            maxBin > 0
          ) {

            ctx.beginPath();

            for (
              let i = 0;
              i <= maxBin;
              i++
            ) {

              const hz =
                (i /
                  data.length) *
                nyquist;

              const x =
                (hz /
                  MAX_ANALYZER_HZ) *
                width;

              const amplitude =
                data[i] /
                255;

              const y =
                height -
                amplitude *
                  height *
                  0.9;

              if (
                i === 0
              ) {

                ctx.moveTo(
                  x,
                  y
                );

              } else {

                ctx.lineTo(
                  x,
                  y
                );
              }
            }

            ctx.strokeStyle =
              "#ffffff";

            ctx.lineWidth =
              2;

            ctx.stroke();
          }
        }

        const hz =
          currentHzRef.current;

        if (
          (
            monitorType ===
              "answer" ||
            monitorType ===
              "mic"
          ) &&
          hz !== null &&
          hz > 0 &&
          hz <=
            MAX_ANALYZER_HZ
        ) {

          const x =
            (hz /
              MAX_ANALYZER_HZ) *
            width;

          const targetIndex =
            questionIndexesRef.current[
              questionRef.current
            ];

          let cents:
            | number
            | null = null;

          if (
            targetIndex !==
              undefined
          ) {

            cents =
              modeRef.current ===
                "mic" &&
              octaveModeRef.current ===
                "tolerant"

                ? frequencyToCentsWithOctaveTolerance(
                    hz,
                    midiToFrequency(
                      NOTES[
                        targetIndex
                      ].midi
                    )
                  )

                : frequencyToCents(
                    hz,
                    midiToFrequency(
                      NOTES[
                        targetIndex
                      ].midi
                    )
                  );
          }

          const status =
  getHintStatus(
    cents,
    modeRef.current,
    hintEnabled,
    targetIndex !== undefined
      ? targetIndex
      : null,
    modeRef.current === "button"
      ? selectedAnswerRef.current
      : detectedNoteRef.current
  );

          if (
            !hintEnabled
          ) {

            ctx.strokeStyle =
              "rgba(255,255,255,0.8)";

          } else if (
            status ===
            "good"
          ) {

            ctx.strokeStyle =
              "rgba(74,222,128,0.95)";

          } else if (
            status ===
            "warning"
          ) {

            ctx.strokeStyle =
              "rgba(250,204,21,0.95)";

          } else if (
            status ===
            "bad"
          ) {

            ctx.strokeStyle =
              "rgba(248,113,113,0.95)";

          } else {

            ctx.strokeStyle =
              "rgba(255,255,255,0.8)";
          }

          ctx.lineWidth =
            1.5;

          ctx.beginPath();

          ctx.moveTo(
            x,
            0
          );

          ctx.lineTo(
            x,
            height
          );

          ctx.stroke();

          ctx.beginPath();

          ctx.arc(
            x,
            10,
            4,
            0,
            Math.PI * 2
          );

          if (
            !hintEnabled
          ) {

            ctx.fillStyle =
              "#ffffff";

          } else if (
            status ===
            "good"
          ) {

            ctx.fillStyle =
              "#4ade80";

          } else if (
            status ===
            "warning"
          ) {

            ctx.fillStyle =
              "#facc15";

          } else if (
            status ===
            "bad"
          ) {

            ctx.fillStyle =
              "#f87171";

          } else {

            ctx.fillStyle =
              "#ffffff";
          }

          ctx.fill();
        }

        analyzerAnimationRef.current =
          requestAnimationFrame(
            draw
          );
      };

    draw();

    window.addEventListener(
      "resize",
      resize
    );

    return () => {

      window.removeEventListener(
        "resize",
        resize
      );

      if (
        analyzerAnimationRef.current !==
        null
      ) {

        cancelAnimationFrame(
          analyzerAnimationRef.current
        );

        analyzerAnimationRef.current =
          null;
      }
    };

  }, [
    monitorType,
    hintEnabled,
  ]);


  /* =======================================================
     Cleanup
  ======================================================= */

  useEffect(() => {

    return () => {

      stopMic();

      stopTone();

      mouseMicRef.current =
        false;

      spaceMicRef.current =
        false;

      const context =
        audioContextRef.current;

      if (
        context &&
        context.state !==
          "closed"
      ) {

        context.close();
      }
    };

  }, [
    stopMic,
    stopTone,
  ]);


  /* =======================================================
     結果計算
  ======================================================= */

  const correctCount =
    results.filter(
      result =>
        result.correct
    ).length;

  const averageExample =
    results.length > 0
      ? results.reduce(
          (
            sum,
            result
          ) =>
            sum +
            result.exampleListens,
          0
        ) /
        results.length
      : 0;

  const averageAnswer =
    results.length > 0
      ? results.reduce(
          (
            sum,
            result
          ) =>
            sum +
            result.answerListens,
          0
        ) /
        results.length
      : 0;

  const accuracyScore =
    (correctCount /
      TOTAL_QUESTIONS) *
    70;

  const exampleScore =
    getListenScore(
      averageExample
    );

  const answerScore =
    getListenScore(
      averageAnswer
    );

  const totalScore =
    Math.round(
      accuracyScore +
        exampleScore +
        answerScore
    );


  /* =======================================================
     現在の問題
  ======================================================= */

  const currentTargetIndex =
    questionIndexes[
      question
    ];

  const targetFrequency =
    currentTargetIndex !==
    undefined
      ? midiToFrequency(
          NOTES[
            currentTargetIndex
          ].midi
        )
      : null;

  let monitorCents:
    | number
    | null = null;

  if (
    targetFrequency !==
      null &&
    currentHz !==
      null &&
    (
      monitorType ===
        "answer" ||
      monitorType ===
        "mic"
    )
  ) {

    monitorCents =
      mode === "mic" &&
      octaveMode === "tolerant"

        ? frequencyToCentsWithOctaveTolerance(
            currentHz,
            targetFrequency
          )

        : frequencyToCents(
            currentHz,
            targetFrequency
          );
  }

  const hintStatus =
  getHintStatus(
    monitorCents,
    mode,
    hintEnabled,
    currentTargetIndex !== undefined
      ? currentTargetIndex
      : null,
    mode === "button"
      ? selectedAnswer
      : detectedNoteIndex
  );

  /*
   * ★変更
   *
   * modeも渡す
   */
  const hintMessage =
    hintEnabled
      ? getHintMessage(
          monitorCents,
          mode
        )
      : "";


  const highCount =
    results.filter(
      result =>
        result.cents !==
          null &&
        result.cents >
          20
    ).length;

  const lowCount =
    results.filter(
      result =>
        result.cents !==
          null &&
        result.cents <
          -20
    ).length;

  const nearCount =
    results.length -
    highCount -
    lowCount;


  /* =======================================================
     結果画面
  ======================================================= */

  if (
    finished
  ) {

    return (
      <main className="min-h-screen bg-white text-slate-900">

        <div
          ref={appRef}
          className="origin-top scale-[0.7]"
        >

          <div className="mx-auto w-full max-w-3xl px-5 py-7">

            <div className="mb-8 text-center">

              <p className="text-sm font-bold tracking-[0.2em] text-slate-500">
                PITCH QUIZ
              </p>

              <h1 className="mt-2 text-4xl font-black">
                結果発表
              </h1>

              <p className="mt-3 text-slate-500">
                5問のトレーニングが終了しました
              </p>

            </div>

            <section className="rounded-[32px] bg-slate-950 p-8 text-center text-white">

              <p className="text-sm font-bold tracking-[0.2em] text-slate-400">
                TOTAL SCORE
              </p>

              <p className="mt-2 text-8xl font-black leading-none">
                {totalScore}
              </p>

              <p className="mt-3 text-xl font-bold">
                / 100 点
              </p>

            </section>

            <div className="mt-5 grid grid-cols-3 gap-3">

              <div className="rounded-3xl bg-slate-100 p-5 text-center">

                <p className="text-sm font-bold text-slate-500">
                  正答率
                </p>

                <p className="mt-2 text-4xl font-black">
                  {Math.round(
                    (
                      correctCount /
                      TOTAL_QUESTIONS
                    ) *
                      100
                  )}
                  %
                </p>

              </div>

              <div className="rounded-3xl bg-slate-100 p-5 text-center">

                <p className="text-sm font-bold text-slate-500">
                  お手本平均
                </p>

                <p className="mt-2 text-4xl font-black">
                  {averageExample.toFixed(
                    1
                  )}

                  <span className="text-lg">
                    回
                  </span>
                </p>

              </div>

              <div className="rounded-3xl bg-slate-100 p-5 text-center">

                <p className="text-sm font-bold text-slate-500">
                  回答音平均
                </p>

                <p className="mt-2 text-4xl font-black">
                  {averageAnswer.toFixed(
                    1
                  )}

                  <span className="text-lg">
                    回
                  </span>
                </p>

              </div>

            </div>

            <section className="mt-5 rounded-3xl border border-slate-200 p-6">

              <h2 className="text-xl font-black">
                音程の傾向
              </h2>

              <p className="mt-3 text-lg font-bold">

                {highCount >
                  lowCount &&
                highCount >
                  nearCount
                  ? "やや高めに取る傾向があります"

                  : lowCount >
                      highCount &&
                    lowCount >
                      nearCount
                  ? "やや低めに取る傾向があります"

                  : "大きな高さの偏りはありません"}

              </p>

              <div className="mt-5 grid grid-cols-3 gap-3">

                <div className="rounded-2xl bg-slate-100 p-4 text-center">

                  <p className="text-xs font-bold text-slate-500">
                    高め
                  </p>

                  <p className="mt-1 text-2xl font-black">
                    {highCount}
                  </p>

                </div>

                <div className="rounded-2xl bg-slate-100 p-4 text-center">

                  <p className="text-xs font-bold text-slate-500">
                    近い
                  </p>

                  <p className="mt-1 text-2xl font-black">
                    {nearCount}
                  </p>

                </div>

                <div className="rounded-2xl bg-slate-100 p-4 text-center">

                  <p className="text-xs font-bold text-slate-500">
                    低め
                  </p>

                  <p className="mt-1 text-2xl font-black">
                    {lowCount}
                  </p>

                </div>

              </div>

            </section>

            <button
              type="button"
              onClick={() =>
                setShowDetails(
                  value =>
                    !value
                )
              }
              className="mt-4 flex w-full items-center justify-between rounded-3xl border border-slate-200 px-6 py-5 font-black"
            >

              <span>
                詳細を見る
              </span>

              <span>
                {showDetails
                  ? "−"
                  : "＋"}
              </span>

            </button>

            {showDetails && (

              <section className="mt-4 space-y-4">

                <div className="rounded-3xl bg-slate-50 p-6">

                  <h3 className="font-black">
                    スコア内訳
                  </h3>

                  <div className="mt-4 space-y-3">

                    <div className="flex justify-between">

                      <span>
                        音の正確さ
                      </span>

                      <strong>
                        {Math.round(
                          accuracyScore
                        )}
                        / 70
                      </strong>

                    </div>

                    <div className="flex justify-between">

                      <span>
                        お手本の聴き方
                      </span>

                      <strong>
                        {exampleScore}/15
                      </strong>

                    </div>

                    <div className="flex justify-between">

                      <span>
                        回答音の聴き方
                      </span>

                      <strong>
                        {answerScore}/15
                      </strong>

                    </div>

                  </div>

                </div>

                {results.map(
                  (
                    result,
                    index
                  ) => {

                    const target =
                      NOTES[
                        result.targetIndex
                      ];

                    const answer =
                      result.answerIndex !==
                      null
                        ? NOTES[
                            result.answerIndex
                          ]
                        : null;

                    return (

                      <div
                        key={
                          index
                        }
                        className="rounded-3xl border border-slate-200 p-5"
                      >

                        <div className="flex items-center justify-between">

                          <strong>
                            第{" "}
                            {index + 1}{" "}
                            問
                          </strong>

                          <span className="font-black">
                            {result.correct
                              ? "正解"
                              : "不正解"}
                          </span>

                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">

                          <div className="rounded-2xl bg-slate-50 p-4">

                            <p className="text-xs font-bold text-slate-500">
                              正解
                            </p>

                            <p className="mt-1 text-2xl font-black">
                              {target.name}
                            </p>

                            <p className="text-sm text-slate-500">
                              {midiToFrequency(
                                target.midi
                              ).toFixed(
                                1
                              )}
                              Hz
                            </p>

                          </div>

                          <div className="rounded-2xl bg-slate-50 p-4">

                            <p className="text-xs font-bold text-slate-500">
                              あなたの回答
                            </p>

                            <p className="mt-1 text-2xl font-black">
                              {answer
                                ? answer.name
                                : "—"}
                            </p>

                            {result.answerFrequency !==
                              null && (

                              <p className="text-sm text-slate-500">
                                {result.answerFrequency.toFixed(
                                  1
                                )}
                                Hz
                              </p>

                            )}

                            {result.cents !==
                              null && (

                              <p className="text-sm text-slate-500">

                                {result.cents >
                                0
                                  ? "+"
                                  : ""}

                                {result.cents.toFixed(
                                  0
                                )}
                                cent

                              </p>

                            )}

                          </div>

                        </div>

                        <div className="mt-4 flex justify-between text-sm text-slate-500">

                          <span>
                            お手本{" "}
                            {
                              result.exampleListens
                            }
                            回
                          </span>

                          <span>
                            回答音{" "}
                            {
                              result.answerListens
                            }
                            回
                          </span>

                        </div>

                      </div>

                    );
                  }
                )}

              </section>

            )}

            <button
              type="button"
              onClick={() => {

                stopMic();

                stopTone();

                mouseMicRef.current =
                  false;

                spaceMicRef.current =
                  false;

                setStarted(
                  false
                );

                setFinished(
                  false
                );

                setQuestionIndexes(
                  []
                );

                setQuestion(
                  0
                );

                setSelectedAnswer(
                  null
                );

                setExampleListens(
                  0
                );

                setAnswerListens(
                  0
                );

                setResults(
                  []
                );

                setShowDetails(
                  false
                );

                setDetectedNoteIndex(
                  null
                );

                setCurrentHz(
                  null
                );

                setMonitorType(
                  "idle"
                );

                setMicError("");

                setMicAnswerReady(
                  false
                );

                currentHzRef.current =
                  null;

                detectedNoteRef.current =
                  null;

                candidateNoteRef.current =
                  null;

                candidateCountRef.current =
                  0;

              }}
              className="mt-7 w-full rounded-3xl bg-slate-950 px-6 py-5 text-lg font-black text-white"
            >
              もう一度挑戦する
            </button>

          </div>

        </div>

      </main>
    );
  }


  /* =======================================================
     スタート画面
  ======================================================= */

  if (
    !started
  ) {

    return (
      <main className="min-h-screen bg-white text-slate-900">

        <div
          ref={appRef}
          className="origin-top scale-[0.7]"
        >

          <div className="mx-auto w-full max-w-3xl px-5 py-7">

            <div className="mb-8 text-center">

              <p className="text-sm font-bold tracking-[0.2em] text-slate-500">
                PITCH QUIZ
              </p>

              <h1 className="mt-2 text-4xl font-black">
                同じ音を当てよう
              </h1>

              <p className="mt-4 leading-7 text-slate-500">
                お手本の音を聴いて、
                <br />
                同じ高さの音を当てるトレーニングです。
              </p>

            </div>

            <section className="rounded-[32px] border border-slate-200 p-7 shadow-sm">

              <h2 className="text-xl font-black">
                回答方法
              </h2>

              <div className="mt-5 grid grid-cols-2 gap-4">

                <button
                  type="button"
                  onClick={() =>
                    setMode(
                      "button"
                    )
                  }
                  className={`rounded-3xl border-2 p-6 text-left ${
                    mode ===
                    "button"
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white"
                  }`}
                >

                  <div className="text-3xl">
                    🎹
                  </div>

                  <p className="mt-3 text-lg font-black">
                    ボタン回答
                  </p>

                  <p className="mt-2 text-sm leading-6 opacity-70">
                    ドレミのボタンから
                    同じ音を選びます。
                  </p>

                </button>

                <button
                  type="button"
                  onClick={() =>
                    setMode(
                      "mic"
                    )
                  }
                  className={`rounded-3xl border-2 p-6 text-left ${
                    mode ===
                    "mic"
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white"
                  }`}
                >

                  <div className="text-3xl">
                    🎤
                  </div>

                  <p className="mt-3 text-lg font-black">
                    マイク回答
                  </p>

                  <p className="mt-2 text-sm leading-6 opacity-70">
                    自分で歌って
                    同じ音を当てます。
                  </p>

                </button>

              </div>

              {mode ===
                "mic" && (

                <div className="mt-4">

                  <p className="text-sm font-bold text-slate-500">
                    オクターブ判定
                  </p>

                  <div className="mt-2 grid grid-cols-2 gap-3">

                    <button
                      type="button"
                      onClick={() =>
                        setOctaveMode(
                          "strict"
                        )
                      }
                      className={`rounded-2xl border-2 px-4 py-3 text-sm font-black ${
                        octaveMode ===
                        "strict"
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      🎯 厳密
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setOctaveMode(
                          "tolerant"
                        )
                      }
                      className={`rounded-2xl border-2 px-4 py-3 text-sm font-black ${
                        octaveMode ===
                        "tolerant"
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      🎵 オクターブ許容
                    </button>

                  </div>

                  <p className="mt-2 text-xs leading-5 text-slate-400">

                    {octaveMode ===
                    "strict"
                      ? "C4のドとC5のドを別の音として判定します。"

                      : "オクターブが違っても同じドレミなら正解になります。"}

                  </p>

                </div>

              )}

              <div className="mt-6 rounded-2xl bg-slate-50 p-5">

                <p className="font-black">
                  全5問
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  お手本は何回でも聴けます。
                  <br />
                  聴く回数が少ないほど高得点になります。
                </p>

              </div>

              <button
                type="button"
                onClick={
                  startGame
                }
                className="mt-6 w-full rounded-3xl bg-slate-950 px-6 py-5 text-lg font-black text-white"
              >
                トレーニングを開始
              </button>

            </section>

          </div>

        </div>

      </main>
    );
  }


  /* =======================================================
     トレーニング画面
  ======================================================= */

  return (
    <main className="min-h-screen bg-white text-slate-900">

      <div
        ref={appRef}
        className="origin-top scale-[0.7]"
      >

        <div className="mx-auto w-full max-w-3xl px-5 py-7">

          <div className="mb-5 flex items-end justify-between">

            <div>

              <p className="text-sm font-bold tracking-[0.15em] text-slate-500">
                PITCH QUIZ
              </p>

              <h1 className="mt-1 text-2xl font-black">
                同じ音を当てよう
              </h1>

            </div>

            <p className="font-black">
              {mode ===
              "button"
                ? "🎹 ボタン"
                : "🎤 マイク"}
            </p>

          </div>


          <div className="mb-5">

            <div className="flex justify-between">

              <p className="font-black">
                第{" "}
                {question + 1}{" "}
                問
              </p>

              <p className="font-bold text-slate-400">
                {question + 1} /{" "}
                {TOTAL_QUESTIONS}
              </p>

            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">

              <div
                className="h-full rounded-full bg-slate-950"
                style={{
                  width: `${
                    (
                      (
                        question +
                        1
                      ) /
                      TOTAL_QUESTIONS
                    ) *
                    100
                  }%`,
                }}
              />

            </div>

          </div>


          {/* =================================================
             お手本
          ================================================= */}

          <section className="rounded-[32px] bg-slate-950 p-6 text-white">

            <p className="text-sm font-bold tracking-[0.15em] text-slate-400">
              LISTEN
            </p>

            <h2 className="mt-2 text-3xl font-black">
              お手本を聴いてください
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              同じ音だと思う音を
              回答してください。
            </p>

            <button
              type="button"
              onClick={
                playExample
              }
              className="mt-5 w-full rounded-3xl bg-white px-6 py-4 text-lg font-black text-slate-950"
            >
              ▶ お手本をもう一度聴く
            </button>

            <p className="mt-3 text-center text-sm text-slate-400">

              お手本再生：

              <span className="ml-1 font-black text-white">
                {exampleListens}
                回
              </span>

            </p>

          </section>


          {/* =================================================
             音のモニター
          ================================================= */}

          <section className="mt-4 overflow-hidden rounded-[28px] bg-slate-900 p-5 text-white">

            <div className="mb-3 flex justify-end">

              <button
                type="button"
                onClick={() =>
                  setHintEnabled(
                    value =>
                      !value
                  )
                }
                className={`rounded-full px-4 py-2 text-xs font-black ${
                  hintEnabled
                    ? "bg-white text-slate-950"
                    : "bg-slate-700 text-slate-300"
                }`}
              >
                ヒント{" "}
                {hintEnabled
                  ? "ON"
                  : "OFF"}
              </button>

            </div>

            <div className="flex h-9 items-center justify-between">

              <div>

                <p className="text-xs font-bold tracking-[0.15em] text-slate-400">
                  SOUND MONITOR
                </p>

                <p className="mt-1 font-black">
                  音のモニター
                </p>

              </div>

              <div className="flex h-9 min-w-[90px] items-center justify-end text-right">

                <div>

                  <p className="text-[10px] text-slate-400">

                    {monitorType ===
                    "mic"
                      ? "マイク入力"

                      : monitorType ===
                          "answer"
                      ? "回答音"

                      : monitorType ===
                          "example"
                      ? "お手本"

                      : "待機中"}

                  </p>

                  {(monitorType ===
                    "mic" ||
                    monitorType ===
                      "answer") && (

                    <p
                      className={`text-xl font-black tabular-nums ${
                        hintEnabled &&
                        hintStatus ===
                          "good"
                          ? "text-green-400"

                          : hintEnabled &&
                            hintStatus ===
                              "warning"
                          ? "text-yellow-400"

                          : hintEnabled &&
                            hintStatus ===
                              "bad"
                          ? "text-red-400"

                          : "text-white"
                      }`}
                    >

                      {currentHz !==
                      null
                        ? currentHz.toFixed(
                            1
                          )
                        : "—"}

                      <span className="ml-1 text-xs">
                        Hz
                      </span>

                    </p>

                  )}

                </div>

              </div>

            </div>


            {/* Analyzer */}

            <div className="mt-3 overflow-hidden rounded-2xl">

              <canvas
                ref={
                  canvasRef
                }
                className="block h-32 w-full"
              />

            </div>


            {/* ヒント */}

            <div className="min-h-[42px]">

              {hintEnabled &&
                (
                  monitorType ===
                    "answer" ||
                  monitorType ===
                    "mic"
                ) &&
                hintMessage && (

                  <div
                    className={`mt-3 rounded-2xl px-4 py-3 text-center text-lg font-black ${
                      hintStatus ===
                      "good"
                        ? "bg-green-500/20 text-green-300"

                        : hintStatus ===
                          "warning"
                        ? "bg-yellow-500/20 text-yellow-300"

                        : "bg-red-500/20 text-red-300"
                    }`}
                  >

                    {hintStatus ===
                      "good" &&
                      "🟢 "}

                    {hintStatus ===
                      "warning" &&
                      "🟡 "}

                    {hintStatus ===
                      "bad" &&
                      "🔴 "}

                    {hintMessage}

                  </div>

                )}

            </div>


            <div className="mt-1 flex justify-between text-[10px] font-bold text-slate-500">

              <span>
                0
              </span>

              <span>
                200
              </span>

              <span>
                400
              </span>

              <span>
                600
              </span>

              <span>
                800
              </span>

              <span>
                1000 Hz
              </span>

            </div>

          </section>


          {/* =================================================
             ボタン回答
          ================================================= */}

          {mode ===
            "button" && (

            <section className="mt-4 rounded-[32px] border border-slate-200 p-5">

              <div className="flex items-center justify-between">

                <div>

                  <p className="text-sm font-bold text-slate-500">
                    ANSWER
                  </p>

                  <h2 className="mt-1 text-xl font-black">
                    同じ音を選んでください
                  </h2>

                </div>

                <p className="font-black">
                  {answerListens}
                  回
                </p>

              </div>

              <div className="mt-5 grid grid-cols-4 gap-3">

                {NOTES.map(
                  (
                    note,
                    index
                  ) => (

                    <button
                      key={
                        `note-${index}`
                      }
                      type="button"
                      onClick={() =>
                        playAnswer(
                          index
                        )
                      }
                      className={`rounded-2xl border-2 py-5 transition active:scale-95 ${
                        selectedAnswer ===
                        index
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >

                      <p className="text-3xl font-black">
                        {note.name}
                      </p>

                      <p className="mt-2 text-xs font-bold opacity-50">
                        {note.key}
                      </p>

                    </button>

                  )
                )}

              </div>

              <p className="mt-4 text-center text-xs leading-5 text-slate-400">
                A / S / D / F / G / H / J / K
                <br />
                のキーボードでも操作できます
              </p>

              <button
                type="button"
                disabled={
                  selectedAnswer ===
                  null
                }
                onClick={
                  submitButton
                }
                className="mt-5 w-full rounded-3xl bg-slate-950 px-6 py-5 text-lg font-black text-white disabled:bg-slate-200 disabled:text-slate-400"
              >
                この回答で確定
              </button>

            </section>

          )}


          {/* =================================================
             マイク回答
          ================================================= */}

          {mode ===
            "mic" && (

            <section className="mt-4 rounded-[32px] border border-slate-200 p-5">

              <p className="text-sm font-bold text-slate-500">
                SING
              </p>

              <h2 className="mt-1 text-xl font-black">
                お手本と同じ音を歌ってください
              </h2>


              <div className="mt-5 h-[190px] overflow-hidden rounded-3xl bg-slate-950 p-6 text-center text-white">

                <p className="text-sm font-bold text-slate-400">

                  {micOn
                    ? "🎤 音を検出中"
                    : micAnswerReady
                    ? "あなたの回答"
                    : "🎤 マイク"}

                </p>

                {micOn && (

                  <div>

                    {detectedNoteIndex !==
                      null ? (

                      <>

                        <p className="mt-2 text-7xl font-black">
                          {
                            NOTES[
                              detectedNoteIndex
                            ].name
                          }
                        </p>

                        <p className="mt-2 text-2xl font-black tabular-nums">

                          {currentHz !==
                          null
                            ? currentHz.toFixed(
                                1
                              )
                            : "—"}

                          <span className="ml-1 text-sm">
                            Hz
                          </span>

                        </p>

                      </>

                    ) : (

                      <p className="mt-10 text-lg font-bold text-slate-400">
                        声を出してください
                      </p>

                    )}

                  </div>

                )}

                {!micOn &&
                  micAnswerReady && (

                  <div>

                    {lockedMicNoteRef.current !==
                      null ? (

                      <>

                        <p className="mt-2 text-7xl font-black">

                          {
                            NOTES[
                              lockedMicNoteRef.current
                            ].name
                          }

                        </p>

                        {lockedMicHzRef.current !==
                          null && (

                          <p className="mt-2 text-2xl font-black tabular-nums">

                            {lockedMicHzRef.current.toFixed(
                              1
                            )}

                            <span className="ml-1 text-sm">
                              Hz
                            </span>

                          </p>

                        )}

                      </>

                    ) : (

                      <p className="mt-10 text-lg font-bold text-slate-400">
                        音を検出できませんでした
                      </p>

                    )}

                  </div>

                )}

                {!micOn &&
                  !micAnswerReady && (

                  <p className="mt-10 text-lg font-bold text-slate-400">
                    下のボタンを押してください
                  </p>

                )}

              </div>


              <div className="min-h-[24px]">

                <p className="mt-4 text-center text-sm font-bold text-slate-500">

                  {micOn &&
                    (
                      detectedNoteIndex !==
                      null
                        ? `現在「${
                            NOTES[
                              detectedNoteIndex
                            ].name
                          }」と判定しています`

                        : "音程を検出しています…"
                    )}

                  {!micOn &&
                    micAnswerReady &&
                    lockedMicNoteRef.current !==
                      null &&
                    `「${
                      NOTES[
                        lockedMicNoteRef.current
                      ].name
                    }」として回答します`}

                </p>

              </div>


              {!micAnswerReady && (

                <button
                  type="button"

                  onMouseDown={(
                    event
                  ) => {

                    event.preventDefault();

                    mouseMicRef.current =
                      true;

                    pressMic();

                  }}

                  onMouseUp={(
                    event
                  ) => {

                    event.preventDefault();

                    mouseMicRef.current =
                      false;

                    releaseMicButton();

                  }}

                  onMouseLeave={() => {

                    mouseMicRef.current =
                      false;

                    releaseMicButton();

                  }}

                  onContextMenu={(
                    event
                  ) => {
                    event.preventDefault();
                  }}

                  className={`mt-5 flex h-[72px] w-full items-center justify-center rounded-3xl px-6 text-lg font-black text-white select-none ${
                    micOn
                      ? "bg-red-500"
                      : "bg-slate-950"
                  }`}
                >

                  {micOn
                    ? "🎤 歌い終わったら離す"
                    : "🎤 押している間歌う"}

                </button>

              )}


              {!micAnswerReady && (

                <p className="mt-3 text-center text-xs font-bold text-slate-400">

                  マウスで押し続けるか、
                  <br />

                  <span className="font-black text-slate-600">
                    Spaceキーを押している間
                  </span>

                  歌ってください

                </p>

              )}


              {micAnswerReady && (

                <div>

                  <button
                    type="button"
                    disabled={
                      lockedMicNoteRef.current ===
                      null
                    }
                    onClick={
                      submitMic
                    }
                    className="mt-5 w-full rounded-3xl bg-slate-950 px-6 py-5 text-lg font-black text-white disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    この音で確定
                  </button>

                  <button
                    type="button"
                    onClick={() => {

                      setMicAnswerReady(
                        false
                      );

                      lockedMicNoteRef.current =
                        null;

                      lockedMicHzRef.current =
                        null;

                      detectedNoteRef.current =
                        null;

                      candidateNoteRef.current =
                        null;

                      candidateCountRef.current =
                        0;

                      setDetectedNoteIndex(
                        null
                      );

                      setCurrentHz(
                        null
                      );

                      currentHzRef.current =
                        null;

                    }}
                    className="mt-3 w-full rounded-3xl border border-slate-200 px-6 py-4 font-black"
                  >
                    もう一度歌う
                  </button>

                </div>

              )}

              {micError && (

                <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-600">
                  {micError}
                </p>

              )}

            </section>

          )}

        </div>

      </div>

    </main>
  );
}