import { useState, type ReactNode } from "react";

/** A password field a handler can read back, so a typo they cannot see cannot lock them out. */
export function PasswordField({
  id,
  label,
  placeholder,
  autoComplete,
  minLength,
  aux,
}: {
  id: string;
  label: string;
  placeholder: string;
  autoComplete: string;
  minLength?: number;
  aux?: ReactNode;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="f">
      <div className="lab">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="aux" onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Show"}
        </button>
        {aux}
      </div>
      <div className="field">
        <input
          id={id}
          name={id}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
      </div>
    </div>
  );
}
