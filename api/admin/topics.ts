import { redis, isAuthenticated } from '../_lib/redis.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = 'admin:topics_queue';

  try {
    // GET: 주제 목록 조회
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const topics = await redis.get<any[]>(key);
      return res.status(200).json({ topics: topics || [] });
    }

    // POST: 새 주제 추가
    if (req.method === 'POST') {
      const { title, template = 'review' } = req.body || {};
      if (!title) return res.status(400).json({ error: 'Title is required' });

      let topics = await redis.get<any[]>(key) || [];
      const newTopic = {
        id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title,
        template,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      
      topics.push(newTopic);
      await redis.set(key, topics);
      return res.status(201).json({ success: true, topic: newTopic });
    }

    // PUT: 주제 상태 또는 내용 수정
    if (req.method === 'PUT') {
      const { id, title, template, status } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID is required' });

      let topics = await redis.get<any[]>(key) || [];
      const index = topics.findIndex(t => t.id === id);
      
      if (index === -1) return res.status(404).json({ error: 'Topic not found' });
      
      if (title) topics[index].title = title;
      if (template) topics[index].template = template;
      if (status) topics[index].status = status;
      
      await redis.set(key, topics);
      return res.status(200).json({ success: true, topic: topics[index] });
    }

    // DELETE: 주제 삭제
    if (req.method === 'DELETE') {
      let topics = await redis.get<any[]>(key) || [];
      const requestedIds = Array.isArray(req.body?.ids)
        ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const deleteAll = req.body?.all === true;
      const queryId = typeof req.query.id === 'string' ? req.query.id : '';
      const ids = requestedIds.length > 0 ? requestedIds : queryId ? [queryId] : [];

      if (!deleteAll && ids.length === 0) return res.status(400).json({ error: 'id, ids, or all is required' });

      const newTopics = deleteAll ? [] : topics.filter(t => !ids.includes(t.id));
      
      await redis.set(key, newTopics);
      return res.status(200).json({ success: true, deletedCount: topics.length - newTopics.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("Topics API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
