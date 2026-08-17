import { useState } from 'react';
import Wordmark from './Wordmark';

/*
 * Sdílené prezentační komponenty auth obrazovek (Login, Register,
 * ForgotPassword, ResetPassword) dle design handoffu (_redesign_zip/README.md).
 * Čistě vizuální vrstva — value/onChange se předávají 1:1, žádný vlastní stav
 * kromě lokálního `show` v PasswordField.
 */

// Jednotný vzhled textových inputů: 44 px (mobil 48), tónovaný podklad, radius 10
const INPUT_CLS =
  'w-full box-border h-11 max-sm:h-12 px-3.5 text-sm text-ink bg-input-bg ' +
  'border border-input rounded-[10px] focus:outline-none focus:border-signal ' +
  'transition-colors placeholder-ink-30';

/** Stránka + centrovaná karta 380 px s FOR/TOOL wordmarkem a mono podtitulkem. */
export function AuthShell({ subtitle, children }) {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-[380px] max-w-full bg-field border border-line rounded-2xl px-8 pt-8 pb-7 shadow-[0_10px_30px_rgba(12,27,42,.07)]">
        <Wordmark size={20} />
        <div className="font-mono font-medium text-[10px] uppercase tracking-[0.16em] text-ink-30 mt-1.5">
          {subtitle}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Mono uppercase štítek pole; `hint` je nenápadný dovětek (např. „· min. 8 znaků"). */
export function FieldLabel({ children, hint }) {
  return (
    <div className="font-mono font-medium text-[10px] uppercase tracking-[0.12em] text-ink-50 mb-1.5">
      {children}
      {hint && <span className="text-ink-10 normal-case tracking-normal"> · {hint}</span>}
    </div>
  );
}

/** Štítek + textový input. Vše mimo label/hint jde 1:1 na <input>. */
export function Field({ label, hint, className = '', ...inputProps }) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <input className={`${INPUT_CLS} ${className}`} {...inputProps} />
    </div>
  );
}

function EyeIcon({ off }) {
  return off ? (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/** Štítek + heslo s přepínačem viditelnosti (oko). */
export function PasswordField({ label, hint, value, onChange, autoComplete, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder || '••••••••'}
          autoComplete={autoComplete}
          className={`${INPUT_CLS} pr-10`}
          required
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(s => !s)}
          aria-label={show ? 'Skrýt heslo' : 'Zobrazit heslo'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-30 hover:text-ink-50 transition-colors"
        >
          <EyeIcon off={show} />
        </button>
      </div>
    </div>
  );
}

/** Primární tlačítko: plná šířka, 48 px, navy s hover. */
export function AuthButton({ children, className = '', ...props }) {
  return (
    <button
      className={`w-full h-12 bg-ink hover:bg-ink-hover text-white text-sm font-bold rounded-[10px] transition-colors disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Informační box pod formulářem. variant: 'signal' (azurový) | 'note' (žlutý). */
export function InfoBox({ variant = 'signal', children }) {
  const tone = variant === 'note'
    ? 'bg-note-bg border-note-border text-note'
    : 'bg-signal-bg border-signal-border text-signal-link';
  return (
    <div className={`px-3 py-2.5 border rounded-lg text-[11.5px] leading-[1.45] ${tone}`}>
      {children}
    </div>
  );
}

/** Chybová hláška formuláře. */
export function ErrorBox({ children }) {
  return (
    <p className="text-sm text-danger bg-danger-bg border border-danger-border rounded-lg px-3 py-2.5">
      {children}
    </p>
  );
}
