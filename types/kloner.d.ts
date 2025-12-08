// src/types/kloner.d.ts
export { };

declare global {
    interface Window {
        __klonerApi?: {
            undo?: () => void;
            redo?: () => void;
            [key: string]: any;
        };
    }
}
