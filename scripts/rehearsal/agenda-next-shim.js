/** Next shell-only imports for the isolated component rehearsal. */
import React from 'react';
export const useRouter = () => ({ pathname: '/', push: () => {} });
export default function ShellLink({ children, href, ...props }) { return <a href={href} {...props}>{children}</a>; }
