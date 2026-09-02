"use client";

import { useEffect, useRef, useState } from "react";

const SOLFEGE = [
  "ド",
  "レ",
  "ミ",
  "ファ",
  "ソ",
  "ラ",
  "シ",
  "ド",
];

const KEYBOARD_KEYS = [
  "a",
  "s",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
];

/*
 * メジャースケール
 *
 * ド   0
 * レ   +2
 * ミ   +4
 * ファ +5
 * ソ   +7
 * ラ   +9
 * シ   +11
 * ド   +12
 */
const MAJOR_SCALE_INTERVALS = [
  0,
  2,
  4,
  5,
  7,
  9,
  11,
  12,
];

/*
 * Cを基準にしたキー
 *
 * -6 ～ +6 半音
 */
const KEY_NAMES: Record<number, string> = {
  [-6]: "F♯",
  [-5]: "G",
  [-4]: "G♯",
  [-3]: "A",
  [-2]: "A♯",
  [-1]: "B",
  [0]: "C",
  [1]: "C♯",
  [2]: "D",
  [3]: "D♯",
  [4]: "E",
  [5]: "F",
  [6]: "F♯",
};

/*
 * 音名
 */
const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const FLAT_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "G♭",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];

const BASE_MIDI = 60; // C4

/*
 * MIDI → Hz
 */
function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/*
 * MIDI → 音名
 */
function midiToPitchName(
  midi: number,
  useFlats = false
) {
  const noteNumber =
    ((midi % 12) + 12) % 12;

  const names = SHARP_NAMES;

  const octave =
    Math.floor(midi / 12) - 1;

  return `${names[noteNumber]}${octave}`;
}

/*
 * Hz → MIDI
 */
function frequencyToMidi(
  frequency: number
) {
  return (
    69 +
    12 * Math.log2(frequency / 440)
  );
}

/*
 * Hz → cents
 */
function getCents(
  frequency: number
) {
  const midi =
    frequencyToMidi(frequency);

  const nearestMidi =
    Math.round(midi);

  return Math.round(
    (midi - nearestMidi) * 100
  );
}

/*
 * Hz → 音名
 */
function getNoteNameFromFrequency(
  frequency: number
) {
  const midi =
    Math.round(
      frequencyToMidi(frequency)
    );

  return midiToPitchName(midi);
}

/*
 * 1つの音を管理するための型
 */
type Voice = {
  oscillators: OscillatorNode[];
  gain: GainNode;
};

export default function PitchPage() {
  /*
   * キー
   *
   * C = 0
   * ±6
   */
  const [keyShift, setKeyShift] =
    useState(0);

  /*
   * 固定ド
   *
   * OFF = 移動ド
   * ON  = 固定ド
   */
  const [fixedDo, setFixedDo] =
    useState(false);

  /*
   * 現在鳴っている音
   *
   * 複数同時に表示できるように配列
   */
  const [playedNotes, setPlayedNotes] =
    useState<string[]>([]);

  /*
   * マイク
   */
  const [detectedNote, setDetectedNote] =
    useState("—");

  const [
    detectedFrequency,
    setDetectedFrequency,
  ] = useState("—");

  const [
    detectedCents,
    setDetectedCents,
  ] = useState<number | null>(null);

  const [micEnabled, setMicEnabled] =
    useState(false);

  const [status, setStatus] =
    useState(
      "ドレミのボタンを押して音を鳴らしてみましょう。"
    );

  /*
   * AudioContext
   */
  const audioContextRef =
    useRef<AudioContext | null>(null);

  /*
   * 同時に鳴っている音
   *
   * index → Voice
   */
  const voicesRef =
    useRef<Map<number, Voice>>(
      new Map()
    );

  /*
   * マイク
   */
  const streamRef =
    useRef<MediaStream | null>(null);

  const analyserRef =
    useRef<AnalyserNode | null>(null);

  const sourceRef =
    useRef<MediaStreamAudioSourceNode | null>(
      null
    );

  const animationRef =
    useRef<number | null>(null);

  /*
   * キーボードで押されているキー
   */
  const pressedKeysRef =
    useRef<Set<string>>(new Set());

  /*
   * AudioContext取得
   */
  const getAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current =
        new AudioContext();
    }

    if (
      audioContextRef.current.state ===
      "suspended"
    ) {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  };

  /*
   * 現在のキー名
   */
  const getCurrentKeyName = () => {
    return KEY_NAMES[keyShift];
  };

  /*
   * 各ドレミのMIDI番号
   */
  const getMidiForIndex = (
    index: number
  ) => {
    return (
      BASE_MIDI +
      keyShift +
      MAJOR_SCALE_INTERVALS[index]
    );
  };

  /*
   * 固定ドの音名
   */
  const getFixedDisplayName = (
    index: number
  ) => {
    const midi =
      getMidiForIndex(index);

    const useFlats =
      [
        -6,
        -4,
        -2,
        1,
        3,
        6,
      ].includes(keyShift);

    return midiToPitchName(
      midi,
      useFlats
    );
  };

  /*
   * ボタン表示
   */
  const getButtonLabel = (
    index: number
  ) => {
    /*
     * 固定ド
     */
    if (fixedDo) {
      return (
        <span>
          {getFixedDisplayName(index)}
        </span>
      );
    }

    /*
     * 移動ド
     */
    return (
      <div>
        <div>
          {SOLFEGE[index]}
        </div>

        {keyShift !== 0 && (
          <div className="mt-1 text-sm font-normal text-gray-400">
            {keyShift > 0 ? "+" : ""}
            {keyShift}
          </div>
        )}
      </div>
    );
  };

  /*
   * 現在鳴っている音を更新
   */
  const updatePlayedNotes = () => {
    const notes: string[] = [];

    voicesRef.current.forEach(
      (_, index) => {
        if (fixedDo) {
          notes.push(
            getFixedDisplayName(index)
          );
        } else {
          notes.push(
            SOLFEGE[index]
          );
        }
      }
    );

    setPlayedNotes(notes);
  };

  /*
   * 音を開始
   *
   * ここが今回の重要ポイント。
   *
   * 前の音を止めず、
   * 新しい音を追加する。
   */
  const startNote = async (
    index: number
  ) => {
    /*
     * すでに同じ音が鳴っている場合
     */
    if (
      voicesRef.current.has(index)
    ) {
      return;
    }

    const audioContext =
      await getAudioContext();

    const midi =
      getMidiForIndex(index);

    const frequency =
      midiToFrequency(midi);

    /*
     * 基音
     */
    const fundamental =
      audioContext.createOscillator();

    /*
     * 倍音
     */
    const harmonic2 =
      audioContext.createOscillator();

    const harmonic3 =
      audioContext.createOscillator();

    const harmonic4 =
      audioContext.createOscillator();

    /*
     * 倍音用Gain
     */
    const gain1 =
      audioContext.createGain();

    const gain2 =
      audioContext.createGain();

    const gain3 =
      audioContext.createGain();

    const gain4 =
      audioContext.createGain();

    /*
     * 全体Gain
     */
    const gain =
      audioContext.createGain();

    /*
     * 音色
     */
    fundamental.type =
      "triangle";

    fundamental.frequency.value =
      frequency;

    harmonic2.type = "sine";
    harmonic2.frequency.value =
      frequency * 2;

    harmonic3.type = "sine";
    harmonic3.frequency.value =
      frequency * 3;

    harmonic4.type = "sine";
    harmonic4.frequency.value =
      frequency * 4;

    /*
     * 倍音バランス
     */
    gain1.gain.value = 0.55;
    gain2.gain.value = 0.18;
    gain3.gain.value = 0.08;
    gain4.gain.value = 0.035;

    /*
     * 音量
     */
    const now =
      audioContext.currentTime;

    gain.gain.setValueAtTime(
      0.0001,
      now
    );

    gain.gain.exponentialRampToValueAtTime(
      0.22,
      now + 0.03
    );

    /*
     * 接続
     */
    fundamental.connect(gain1);
    harmonic2.connect(gain2);
    harmonic3.connect(gain3);
    harmonic4.connect(gain4);

    gain1.connect(gain);
    gain2.connect(gain);
    gain3.connect(gain);
    gain4.connect(gain);

    gain.connect(
      audioContext.destination
    );

    /*
     * 開始
     */
    fundamental.start();
    harmonic2.start();
    harmonic3.start();
    harmonic4.start();

    /*
     * Voiceとして保存
     */
    voicesRef.current.set(index, {
      oscillators: [
        fundamental,
        harmonic2,
        harmonic3,
        harmonic4,
      ],
      gain,
    });

    /*
     * 表示
     */
    updatePlayedNotes();
  };

  /*
   * 音を停止
   *
   * indexで指定した音だけ止める
   */
  const stopNote = (
    index: number
  ) => {
    const voice =
      voicesRef.current.get(index);

    if (!voice) {
      return;
    }

    const audioContext =
      audioContextRef.current;

    if (!audioContext) {
      return;
    }

    const now =
      audioContext.currentTime;

    /*
     * フェードアウト
     */
    try {
      voice.gain.gain.cancelScheduledValues(
        now
      );

      voice.gain.gain.setValueAtTime(
        Math.max(
          voice.gain.gain.value,
          0.0001
        ),
        now
      );

      voice.gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + 0.08
      );
    } catch {}

    /*
     * 100ms後にオシレーター停止
     */
    setTimeout(() => {
      voice.oscillators.forEach(
        (oscillator) => {
          try {
            oscillator.stop();
          } catch {}
        }
      );
    }, 100);

    /*
     * Mapから削除
     */
    voicesRef.current.delete(index);

    /*
     * 表示更新
     */
    updatePlayedNotes();
  };

  /*
   * ボタンを押した
   */
  const handlePointerDown = (
    index: number,
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    /*
     * ポインターをボタンに固定
     *
     * 押したまま外に出ても
     * pointerupを受け取れる
     */
    try {
      event.currentTarget.setPointerCapture(
        event.pointerId
      );
    } catch {}

    startNote(index);
  };

  /*
   * ボタンを離した
   */
  const handlePointerUp = (
    index: number
  ) => {
    stopNote(index);
  };

  /*
   * マイク音程検出
   */
  const detectPitch = () => {
    const analyser =
      analyserRef.current;

    if (!analyser) {
      return;
    }

    const buffer =
      new Float32Array(
        analyser.fftSize
      );

    analyser.getFloatTimeDomainData(
      buffer
    );

    /*
     * RMS
     */
    let rms = 0;

    for (
      let i = 0;
      i < buffer.length;
      i++
    ) {
      rms +=
        buffer[i] *
        buffer[i];
    }

    rms = Math.sqrt(
      rms / buffer.length
    );

    /*
     * 音が小さい
     */
    if (rms < 0.01) {
      animationRef.current =
        requestAnimationFrame(
          detectPitch
        );

      return;
    }

    /*
     * 自己相関
     */
    let bestCorrelation = 0;
    let bestLag = -1;

    const minFrequency = 70;
    const maxFrequency = 1000;

    const sampleRate =
      analyser.context.sampleRate;

    const minLag =
      Math.floor(
        sampleRate /
          maxFrequency
      );

    const maxLag =
      Math.floor(
        sampleRate /
          minFrequency
      );

    for (
      let lag = minLag;
      lag <= maxLag &&
      lag < buffer.length / 2;
      lag++
    ) {
      let correlation = 0;

      for (
        let i = 0;
        i < buffer.length - lag;
        i++
      ) {
        correlation +=
          buffer[i] *
          buffer[i + lag];
      }

      if (
        correlation >
        bestCorrelation
      ) {
        bestCorrelation =
          correlation;

        bestLag = lag;
      }
    }

    /*
     * 音程表示
     */
    if (
      bestLag > 0 &&
      bestCorrelation > 0
    ) {
      const frequency =
        sampleRate / bestLag;

      if (
        frequency >=
          minFrequency &&
        frequency <=
          maxFrequency
      ) {
        const noteName =
          getNoteNameFromFrequency(
            frequency
          );

        const cents =
          getCents(frequency);

        setDetectedNote(
          noteName
        );

        setDetectedFrequency(
          `${frequency.toFixed(
            1
          )} Hz`
        );

        setDetectedCents(
          cents
        );
      }
    }

    animationRef.current =
      requestAnimationFrame(
        detectPitch
      );
  };

  /*
   * マイクON/OFF
   */
  const toggleMicrophone =
    async () => {
      /*
       * OFF
       */
      if (micEnabled) {
        if (
          animationRef.current
        ) {
          cancelAnimationFrame(
            animationRef.current
          );

          animationRef.current =
            null;
        }

        if (streamRef.current) {
          streamRef.current
            .getTracks()
            .forEach((track) => {
              track.stop();
            });

          streamRef.current = null;
        }

        sourceRef.current =
          null;

        analyserRef.current =
          null;

        setMicEnabled(false);

        setDetectedNote("—");
        setDetectedFrequency("—");
        setDetectedCents(null);

        setStatus(
          "マイクをOFFにしました。"
        );

        return;
      }

      /*
       * ON
       */
      try {
        if (
          !navigator.mediaDevices
            ?.getUserMedia
        ) {
          setStatus(
            "このブラウザではマイク機能を利用できません。"
          );

          return;
        }

        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
              },
            }
          );

        const audioContext =
          await getAudioContext();

        const source =
          audioContext.createMediaStreamSource(
            stream
          );

        const analyser =
          audioContext.createAnalyser();

        analyser.fftSize = 2048;

        analyser.smoothingTimeConstant = 0;

        source.connect(analyser);

        streamRef.current =
          stream;

        sourceRef.current =
          source;

        analyserRef.current =
          analyser;

        setMicEnabled(true);

        setStatus(
          "声を出してみましょう。音程をリアルタイムで表示します。"
        );

        detectPitch();
      } catch (error) {
        console.error(error);

        setStatus(
          "マイクを使用できませんでした。ブラウザのマイク許可を確認してください。"
        );
      }
    };

  /*
   * キーボード
   *
   * 複数キー同時押し対応
   */
  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (event.repeat) {
        return;
      }

      const target =
        event.target as HTMLElement | null;

      /*
       * 入力欄では反応させない
       */
      if (
        target?.tagName === "INPUT" ||
        target?.tagName ===
          "TEXTAREA" ||
        target?.tagName ===
          "SELECT"
      ) {
        return;
      }

      const key =
        event.key.toLowerCase();

      const index =
        KEYBOARD_KEYS.indexOf(
          key
        );

      if (index === -1) {
        return;
      }

      /*
       * すでに押されている場合
       */
      if (
        pressedKeysRef.current.has(
          key
        )
      ) {
        return;
      }

      pressedKeysRef.current.add(
        key
      );

      event.preventDefault();

      startNote(index);
    };

    const handleKeyUp = (
      event: KeyboardEvent
    ) => {
      const key =
        event.key.toLowerCase();

      const index =
        KEYBOARD_KEYS.indexOf(
          key
        );

      if (index === -1) {
        return;
      }

      pressedKeysRef.current.delete(
        key
      );

      stopNote(index);
    };

    /*
     * キーボード操作
     */
    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    window.addEventListener(
      "keyup",
      handleKeyUp
    );

    /*
     * ウィンドウからフォーカスが外れた場合
     *
     * 音が鳴りっぱなしになるのを防ぐ
     */
    const handleBlur = () => {
      pressedKeysRef.current.clear();

      voicesRef.current.forEach(
        (_, index) => {
          stopNote(index);
        }
      );
    };

    window.addEventListener(
      "blur",
      handleBlur
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

      window.removeEventListener(
        "blur",
        handleBlur
      );
    };
  });

  /*
   * 固定ドON/OFF時に
   * 現在表示している音名を更新
   */
  useEffect(() => {
    updatePlayedNotes();
  }, [fixedDo, keyShift]);

  /*
   * ページを離れるとき
   */
  useEffect(() => {
    return () => {
      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }

      if (streamRef.current) {
        streamRef.current
          .getTracks()
          .forEach((track) => {
            track.stop();
          });
      }

      voicesRef.current.forEach(
        (voice) => {
          voice.oscillators.forEach(
            (oscillator) => {
              try {
                oscillator.stop();
              } catch {}
            }
          );
        }
      );

      voicesRef.current.clear();

      if (
        audioContextRef.current
      ) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <main className="min-h-[1400px] bg-white text-gray-900">
      <div className="mx-auto max-w-6xl px-4 py-8">
  <div className="origin-top scale-[0.8]">

        {/* タイトル */}
        <header className="mb-8 text-center">

          <h1 className="text-3xl font-bold tracking-tight">
            ドレミ音感トレーニング
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            メジャースケールの音を鳴らして覚えよう
          </p>

        </header>

        {/* 固定ドスイッチ */}
        <section className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-5">

          <div className="flex items-center justify-between gap-4">

            <div>
              <div className="text-sm font-semibold">
                固定ド
              </div>

              <div className="mt-1 text-xs text-gray-500">
                {fixedDo
                  ? "実際の音名を表示"
                  : "ドレミ＋キーの移動量を表示"}
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={fixedDo}
              onClick={() =>
                setFixedDo(
                  (value) => !value
                )
              }
              className={`relative h-8 w-14 rounded-full transition ${
                fixedDo
                  ? "bg-blue-600"
                  : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${
                  fixedDo
                    ? "left-7"
                    : "left-1"
                }`}
              />
            </button>

          </div>

        </section>

        {/* キー変更 */}
        <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">

          <div className="text-center text-sm font-semibold">
            メジャーキー
          </div>

          <div className="mt-5 flex flex-col items-center">

            {/* ＋ */}
            <button
              type="button"
              onClick={() =>
                setKeyShift(
                  (value) =>
                    Math.min(
                      6,
                      value + 1
                    )
                )
              }
              disabled={
                keyShift >= 6
              }
              className="flex h-11 w-20 items-center justify-center rounded-xl border border-gray-300 bg-white text-xl font-bold disabled:opacity-30"
            >
              ＋
            </button>

            {/* 現在のキー */}
            <div className="my-3 flex min-w-40 flex-col items-center rounded-2xl border-2 border-blue-500 bg-blue-50 px-8 py-5">

              <div className="text-4xl font-bold text-blue-700">
                {getCurrentKeyName()}
              </div>

              <div className="mt-1 text-sm text-blue-600">
                {keyShift === 0
                  ? "C = 0"
                  : keyShift > 0
                  ? `＋${keyShift}`
                  : `−${Math.abs(
                      keyShift
                    )}`}
              </div>

            </div>

            {/* − */}
            <button
              type="button"
              onClick={() =>
                setKeyShift(
                  (value) =>
                    Math.max(
                      -6,
                      value - 1
                    )
                )
              }
              disabled={
                keyShift <= -6
              }
              className="flex h-11 w-20 items-center justify-center rounded-xl border border-gray-300 bg-white text-xl font-bold disabled:opacity-30"
            >
              −
            </button>

          </div>

          {/* リセット */}
          <div className="mt-4 text-center">

            <button
              type="button"
              onClick={() =>
                setKeyShift(0)
              }
              disabled={
                keyShift === 0
              }
              className="rounded-xl border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-600 disabled:opacity-30"
            >
              Cに戻す
            </button>

          </div>

          <div className="mt-3 text-center text-xs text-gray-400">
            Cを基準に±6半音
          </div>

        </section>

        {/* 現在鳴っている音 */}
        <section className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">

          <div className="text-sm font-semibold text-gray-500">
            今鳴らしている音
          </div>

          <div className="mt-3 flex min-h-14 flex-wrap items-center justify-center gap-3">

            {playedNotes.length === 0 ? (
              <div className="text-5xl font-bold">
                —
              </div>
            ) : (
              playedNotes.map(
                (note, index) => (
                  <div
                    key={`${note}-${index}`}
                    className="text-4xl font-bold"
                  >
                    {note}
                  </div>
                )
              )
            )}

          </div>

          {playedNotes.length > 1 && (
            <div className="mt-2 text-xs text-gray-400">
              複数の音が同時に鳴っています
            </div>
          )}

        </section>

        {/* ドレミボタン */}
        <section className="mb-5">

          <div className="mb-3 text-center text-sm font-semibold text-gray-600">
            ドレミを鳴らす
          </div>

          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">

            {SOLFEGE.map(
              (note, index) => {

                const isActive =
                  voicesRef.current.has(
                    index
                  );

                return (
                  <button
                    key={`${note}-${index}`}
                    type="button"
                    onPointerDown={(
                      event
                    ) => {
                      event.preventDefault();

                      handlePointerDown(
                        index,
                        event
                      );
                    }}
                    onPointerUp={() =>
                      handlePointerUp(
                        index
                      )
                    }
                    onPointerCancel={() =>
                      handlePointerUp(
                        index
                      )
                    }
                    className={`min-h-24 touch-none select-none rounded-2xl border px-2 py-3 text-lg font-bold shadow-sm transition ${
                      isActive
                        ? "border-blue-500 bg-blue-50 text-blue-700 scale-95"
                        : "border-gray-300 bg-white hover:bg-gray-50"
                    }`}
                  >

                    <span>
                      {getButtonLabel(
                        index
                      )}
                    </span>

                    <span className="mt-2 block text-xs font-normal text-gray-400">
                      {KEYBOARD_KEYS[
                        index
                      ].toUpperCase()}
                    </span>

                    <span className="mt-1 block text-[10px] font-normal text-gray-300">
                      {midiToFrequency(
                        getMidiForIndex(
                          index
                        )
                      ).toFixed(0)}
                      Hz
                    </span>

                  </button>
                );
              }
            )}

          </div>

          <p className="mt-3 text-center text-xs text-gray-400">
            複数のボタンを同時に押すと、和音として鳴らせます
          </p>

          <p className="mt-1 text-center text-xs text-gray-400">
            A・S・D・F・G・H・J・Kでも同時押しできます
          </p>

        </section>

        {/* マイク */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6">

          <div className="text-center text-sm font-semibold text-gray-500">
            マイクで検出中
          </div>

          <div className="mt-4 rounded-2xl bg-gray-50 p-6 text-center">

            <div className="text-5xl font-bold">
              {detectedNote}
            </div>

            <div className="mt-3 text-sm text-gray-500">
              {detectedFrequency}
            </div>

            {detectedCents !==
              null && (
              <div className="mt-1 text-sm font-semibold">
                {detectedCents >= 0
                  ? "+"
                  : ""}
                {detectedCents} cents
              </div>
            )}

          </div>

          <button
            type="button"
            onClick={
              toggleMicrophone
            }
            className={`mt-5 min-h-12 w-full rounded-xl px-5 py-3 font-bold transition ${
              micEnabled
                ? "border border-red-200 bg-red-50 text-red-600"
                : "bg-blue-600 text-white"
            }`}
          >
            {micEnabled
              ? "🎤 マイクOFF"
              : "🎤 マイクON"}
          </button>

          <p className="mt-4 text-center text-sm text-gray-500">
            {status}
          </p>

        </section>

</div>
      </div>
    </main>
  );
}