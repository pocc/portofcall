import { useState, useCallback, useRef } from 'react';

interface ValidationRule {
  test: (value: string) => boolean;
  message: string;
}

interface FieldValidation {
  [fieldName: string]: ValidationRule[];
}

export function useFormValidation(validations: FieldValidation) {
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Use a ref so callbacks are stable even when validations object is recreated
  const validationsRef = useRef(validations);
  validationsRef.current = validations;

  const validate = useCallback(
    (fieldName: string, value: string): boolean => {
      const rules = validationsRef.current[fieldName];
      if (!rules) return true;

      for (const rule of rules) {
        if (!rule.test(value)) {
          setErrors((prev) => ({ ...prev, [fieldName]: rule.message }));
          return false;
        }
      }

      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
      return true;
    },
    []
  );

  const validateAll = useCallback(
    (values: { [key: string]: string }): boolean => {
      let isValid = true;
      const newErrors: { [key: string]: string } = {};

      for (const [fieldName, value] of Object.entries(values)) {
        const rules = validationsRef.current[fieldName];
        if (!rules) continue;

        for (const rule of rules) {
          if (!rule.test(value)) {
            newErrors[fieldName] = rule.message;
            isValid = false;
            break;
          }
        }
      }

      setErrors(newErrors);
      return isValid;
    },
    []
  );

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const clearError = useCallback((fieldName: string) => {
    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  }, []);

  return {
    errors,
    validate,
    validateAll,
    clearErrors,
    clearError,
  };
}

// Common validation rules
export const validationRules = {
  required: (message = 'This field is required'): ValidationRule => ({
    test: (value: string) => value.trim().length > 0,
    message,
  }),

  minLength: (min: number, message?: string): ValidationRule => ({
    test: (value: string) => value.length >= min,
    message: message || `Must be at least ${min} characters`,
  }),

  maxLength: (max: number, message?: string): ValidationRule => ({
    test: (value: string) => value.length <= max,
    message: message || `Must be no more than ${max} characters`,
  }),

  port: (message = 'Port must be between 1 and 65535'): ValidationRule => ({
    test: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= 1 && num <= 65535;
    },
    message,
  }),

  hostname: (message = 'Invalid hostname'): ValidationRule => ({
    test: (value: string) => {
      // Simple hostname validation
      const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return hostnameRegex.test(value);
    },
    message,
  }),

  number: (message = 'Must be a valid number'): ValidationRule => ({
    test: (value: string) => !isNaN(parseInt(value)),
    message,
  }),

  range: (min: number, max: number, message?: string): ValidationRule => ({
    test: (value: string) => {
      const num = parseInt(value);
      return !isNaN(num) && num >= min && num <= max;
    },
    message: message || `Must be between ${min} and ${max}`,
  }),
};
