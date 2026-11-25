import React from 'react';

const COLORS = [
  ['#1d4ed8', '#dbeafe'], ['#2563eb', '#eff6ff'], ['#7c3aed', '#f3e8ff'],
  ['#5b21b6', '#ede9fe'], ['#1e40af', '#dbeafe'], ['#8b5cf6', '#f5f3ff'],
  ['#312e81', '#e0e7ff'], ['#3730a3', '#eef2ff'], ['#4338ca', '#e0e7ff'],
];

const getColor = (name = '') => {
  const idx = name.charCodeAt(0) % COLORS.length;
  return COLORS[idx];
};

const getInitials = (name = '') => {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const sizeMap = {
  xs: 'avatar-xs', sm: 'avatar-sm', md: 'avatar-md',
  lg: 'avatar-lg', xl: 'avatar-xl', '2xl': 'avatar-2xl',
};

const Avatar = ({ src, name = '', size = 'md', className = '', style = {} }) => {
  const [imgErr, setImgErr] = React.useState(false);
  const sizeClass = sizeMap[size] || sizeMap.md;
  const [fg, bg] = getColor(name);

  if (src && !imgErr) {
    return (
      <img
        src={src}
        alt={name}
        className={`avatar ${sizeClass} ${className}`}
        style={style}
        onError={() => setImgErr(true)}
      />
    );
  }

  return (
    <div
      className={`avatar-placeholder ${sizeClass} ${className}`}
      style={{ background: bg, color: fg, ...style }}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
};

export default Avatar;
