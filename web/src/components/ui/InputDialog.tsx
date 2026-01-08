/**
 * Input Dialog Component
 *
 * A reusable dialog with text input for collecting user input with confirmation.
 * Used for operations requiring a reason or note.
 */

import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export interface InputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  message: string;
  inputLabel: string;
  inputPlaceholder?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;
}

export default function InputDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  inputLabel,
  inputPlaceholder = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "warning",
  isLoading = false,
  required = true,
  minLength = 3,
  maxLength = 500,
  multiline = false,
}: InputDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setValue("");
      setError("");
    }
  }, [isOpen]);

  const handleConfirm = () => {
    // Validation
    if (required && !value.trim()) {
      setError("This field is required");
      return;
    }

    if (value.trim().length < minLength) {
      setError(`Must be at least ${minLength} characters`);
      return;
    }

    if (value.length > maxLength) {
      setError(`Must not exceed ${maxLength} characters`);
      return;
    }

    onConfirm(value.trim());
  };

  const variantStyles = {
    danger: {
      icon: "text-red-600",
      button: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
    },
    warning: {
      icon: "text-yellow-600",
      button: "bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500",
    },
    info: {
      icon: "text-blue-600",
      button: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
    },
  };

  const styles = variantStyles[variant];
  const isValid =
    !required ||
    (value.trim().length >= minLength && value.length <= maxLength);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25 dark:bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 p-6 text-left align-middle shadow-xl transition-all">
                <div className="absolute right-4 top-4">
                  <button
                    type="button"
                    className="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={onClose}
                    aria-label="Close dialog"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex items-start mb-4">
                  <div
                    className={`flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full ${
                      variant === "danger"
                        ? "bg-red-100 dark:bg-red-900/20"
                        : variant === "warning"
                        ? "bg-yellow-100 dark:bg-yellow-900/20"
                        : "bg-blue-100 dark:bg-blue-900/20"
                    } sm:h-10 sm:w-10`}
                  >
                    <ExclamationTriangleIcon
                      className={`h-6 w-6 ${styles.icon}`}
                    />
                  </div>
                  <div className="ml-4 flex-1">
                    <Dialog.Title
                      as="h3"
                      className="text-lg font-medium leading-6 text-gray-900 dark:text-gray-100"
                    >
                      {title}
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {message}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <label
                    htmlFor="dialog-input"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    {inputLabel}
                    {required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {multiline ? (
                    <textarea
                      id="dialog-input"
                      rows={3}
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder={inputPlaceholder}
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        setError("");
                      }}
                      maxLength={maxLength}
                      disabled={isLoading}
                    />
                  ) : (
                    <input
                      id="dialog-input"
                      type="text"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder={inputPlaceholder}
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        setError("");
                      }}
                      maxLength={maxLength}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isValid) {
                          handleConfirm();
                        }
                      }}
                    />
                  )}
                  <div className="mt-1 flex justify-between items-center">
                    {error ? (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {error}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {minLength > 0 && `Min ${minLength} characters. `}
                        {value.length}/{maxLength}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex gap-3 justify-end">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    onClick={onClose}
                    disabled={isLoading}
                  >
                    {cancelText}
                  </button>
                  <button
                    type="button"
                    className={`inline-flex justify-center rounded-md border border-transparent ${styles.button} px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50`}
                    onClick={handleConfirm}
                    disabled={isLoading || !isValid}
                  >
                    {isLoading ? "Processing..." : confirmText}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
