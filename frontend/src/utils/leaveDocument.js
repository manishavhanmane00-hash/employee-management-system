const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 4 * 1024 * 1024;

export const readLeaveDocument = file => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  if (!ALLOWED_TYPES.includes(file.type)) {
    return reject(new Error('Choose a PDF, PNG, or JPEG document.'));
  }
  if (!file.size) {
    return reject(new Error('The selected supporting document is empty.'));
  }
  if (file.size > MAX_FILE_SIZE) {
    return reject(new Error('Supporting documents must not exceed 4 MB.'));
  }
  const reader = new FileReader();
  reader.onload = () => resolve({
    name: file.name,
    mimeType: file.type,
    data: reader.result,
  });
  reader.onerror = () => reject(new Error('Unable to read the selected document.'));
  reader.readAsDataURL(file);
});
