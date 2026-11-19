const express = require('express');
const router = express.Router();
const { protect, superAdminOnly } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const {
  getSuggestions, answer, searchKnowledge, saveFeedback, getFeedbackAnalytics,
  saveArticle, listArticles, deleteArticle, createTicket, listTickets,
  updateTicket, addTicketComment, requireTicketManager,
} = require('../controllers/chatController');

router.use(protect, checkPermission('chatbot'));

router.get('/suggestions', getSuggestions);
router.post('/answer', answer);
router.get('/knowledge/search', searchKnowledge);
router.post('/feedback', saveFeedback);
router.get('/feedback/analytics', superAdminOnly, getFeedbackAnalytics);
router.get('/knowledge/articles', superAdminOnly, listArticles);
router.post('/knowledge/articles', superAdminOnly, saveArticle);
router.delete('/knowledge/articles/:id', superAdminOnly, deleteArticle);
router.post('/tickets', createTicket);
router.get('/tickets', listTickets);
router.post('/tickets/:id/comments', addTicketComment);
router.patch('/tickets/:id', requireTicketManager, updateTicket);

module.exports = router;
